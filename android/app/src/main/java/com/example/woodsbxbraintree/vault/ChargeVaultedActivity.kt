package com.example.woodsbxbraintree.vault

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.widget.doAfterTextChanged
import androidx.lifecycle.lifecycleScope
import com.example.woodsbxbraintree.R
import com.example.woodsbxbraintree.shared.ApiClient
import com.example.woodsbxbraintree.shared.DiagnosticsLog
import com.example.woodsbxbraintree.shared.applyImeInsetsAsPadding
import com.example.woodsbxbraintree.shared.hideKeyboard
import com.google.android.material.textfield.TextInputEditText
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Vault > Charge Vaulted.
 *
 * No Braintree SDK client is used on this screen at all — it only talks to
 * the server:
 *   GET  /api/vault/customers  -> list customers + their vaulted payment methods
 *   POST /api/vault/charge     -> charge a chosen paymentMethodToken directly
 *
 * Both endpoints are NEW additions required in server.js — see the diff.
 * Works identically regardless of which screen originally vaulted the
 * payment method (Store: Card, Store: PayPal, or either Checkout with Vault
 * screen), since they all end up as a payment method token on a customer.
 *
 * UX note from testing: merchant accounts can have 40+ vaulted customers,
 * and scrolling past all of them to reach the log panel was painful. Fix:
 *   - Fetch the full list once (cheap, one request), keep it in memory.
 *   - With no search text: show only the 3 MOST RECENT customers
 *     (sorted by createdAt descending).
 *   - With search text: filter the FULL in-memory list by customer ID
 *     substring match (case-insensitive), no 3-item cap.
 */
class ChargeVaultedActivity : ComponentActivity() {

    private val diagnostics = DiagnosticsLog()

    private lateinit var amountEdit: TextInputEditText
    private lateinit var refreshButton: Button
    private lateinit var searchEdit: TextInputEditText
    private lateinit var listHeaderText: TextView
    private lateinit var methodsContainer: LinearLayout
    private lateinit var emptyStateText: TextView

    /** Full fetched list, kept in memory so search/sort never needs a re-fetch. */
    private var allCustomers: List<JSONObject> = emptyList()

    private companion object {
        const val DEFAULT_VISIBLE_COUNT = 3
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applyImeInsetsAsPadding()
        setContentView(R.layout.activity_vaultcharge)

        diagnostics.bind(findViewById<TextView>(R.id.logText))
        amountEdit = findViewById(R.id.amountEdit)
        refreshButton = findViewById(R.id.refreshButton)
        searchEdit = findViewById(R.id.searchEdit)
        listHeaderText = findViewById(R.id.listHeaderText)
        methodsContainer = findViewById(R.id.methodsContainer)
        emptyStateText = findViewById(R.id.emptyStateText)

        refreshButton.setOnClickListener { hideKeyboard(); refreshList() }
        searchEdit.doAfterTextChanged { renderFilteredList() }

        refreshList()
    }

    private fun amount(): String = amountEdit.text?.toString().orEmpty().ifBlank { "12.34" }

    private fun refreshList() {
        methodsContainer.removeAllViews()
        emptyStateText.text = "Loading…"
        emptyStateText.visibility = View.VISIBLE

        lifecycleScope.launch {
            diagnostics.info("Fetching vaulted customers…")
            val result = ApiClient.vaultCustomers()
            val customersJson = result.getOrNull()
            if (customersJson == null) {
                diagnostics.error("Failed to load vaulted customers: ${result.exceptionOrNull()?.message}")
                emptyStateText.text = "Failed to load — check server connection and /api/vault/customers."
                return@launch
            }

            allCustomers = (0 until customersJson.length()).map { customersJson.getJSONObject(it) }
            diagnostics.success("Loaded ${allCustomers.size} customer(s)")
            renderFilteredList()
        }
    }

    /** Applies the current search text (if any) and re-renders the list + header. */
    private fun renderFilteredList() {
        methodsContainer.removeAllViews()

        val query = searchEdit.text?.toString()?.trim().orEmpty()

        val toDisplay: List<JSONObject>
        if (query.isBlank()) {
            listHeaderText.text = "Vaulted payment methods ($DEFAULT_VISIBLE_COUNT most recent)"
            toDisplay = allCustomers
                .sortedByDescending { it.optString("createdAt", "") } // ISO 8601 sorts correctly as strings
                .take(DEFAULT_VISIBLE_COUNT)
        } else {
            listHeaderText.text = "Vaulted payment methods (matching \"$query\")"
            toDisplay = allCustomers.filter {
                it.optString("id", "").contains(query, ignoreCase = true)
            }
        }

        var rowCount = 0
        for (customer in toDisplay) {
            val customerId = customer.optString("id", "?")
            val paymentMethods = customer.optJSONArray("paymentMethods") ?: continue
            for (j in 0 until paymentMethods.length()) {
                addRow(customerId, paymentMethods.getJSONObject(j))
                rowCount++
            }
        }

        emptyStateText.visibility = if (rowCount == 0) View.VISIBLE else View.GONE
        emptyStateText.text = when {
            allCustomers.isEmpty() -> "No vaulted payment methods yet — try Vault > Store: Card or Store: PayPal first."
            query.isNotBlank() && rowCount == 0 -> "No customer ID matching \"$query\"."
            else -> emptyStateText.text
        }
    }

    private fun addRow(customerId: String, paymentMethod: JSONObject) {
        val token = paymentMethod.optString("token", null) ?: return
        val description = describe(customerId, paymentMethod)

        val row = LayoutInflater.from(this).inflate(R.layout.row_vaulted_method, methodsContainer, false)
        row.findViewById<TextView>(R.id.methodDescriptionText).text = description
        row.findViewById<Button>(R.id.chargeRowButton).setOnClickListener {
            hideKeyboard()
            chargeToken(token, description)
        }
        methodsContainer.addView(row)
    }

    /** Best-effort human-readable label — adjust field names to match your server.js response shape. */
    private fun describe(customerId: String, pm: JSONObject): String {
        val cardType = pm.optString("cardType", "").ifEmpty { null }
        val last4 = pm.optString("last4", "").ifEmpty { null }
        val email = pm.optString("email", "").ifEmpty { null }
        val username = pm.optString("username", "").ifEmpty { null }
        return when {
            cardType != null && last4 != null -> "$cardType ending $last4 — $customerId"
            username != null -> "Venmo (@$username) — $customerId"
            email != null -> "PayPal ($email) — $customerId"
            else -> "Payment method ${pm.optString("token", "?")} — $customerId"
        }
    }

    private fun chargeToken(token: String, description: String) {
        val amt = amount()
        lifecycleScope.launch {
            diagnostics.info("Charging $description — amount=$amt")
            ApiClient.vaultCharge(paymentMethodToken = token, amount = amt)
                .onSuccess { diagnostics.raw("Server response:\n$it") }
                .onFailure { diagnostics.error("Server call failed: ${it.message}") }
        }
    }
}
