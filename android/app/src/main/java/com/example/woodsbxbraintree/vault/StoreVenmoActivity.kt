package com.example.woodsbxbraintree.vault

import android.content.Intent
import android.os.Bundle
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import com.braintreepayments.api.venmo.VenmoClient
import com.braintreepayments.api.venmo.VenmoLauncher
import com.braintreepayments.api.venmo.VenmoPaymentAuthRequest
import com.braintreepayments.api.venmo.VenmoPaymentAuthResult
import com.braintreepayments.api.venmo.VenmoPaymentMethodUsage
import com.braintreepayments.api.venmo.VenmoPendingRequest
import com.braintreepayments.api.venmo.VenmoRequest
import com.braintreepayments.api.venmo.VenmoResult
import com.example.woodsbxbraintree.R
import com.example.woodsbxbraintree.shared.ApiClient
import com.example.woodsbxbraintree.shared.DiagnosticsLog
import com.example.woodsbxbraintree.shared.ReturnUrls
import com.example.woodsbxbraintree.shared.applyImeInsetsAsPadding
import com.example.woodsbxbraintree.shared.hideKeyboard
import com.google.android.material.button.MaterialButton
import kotlinx.coroutines.launch

/**
 * Vault > Store: Venmo.
 *
 * Uses VenmoPaymentMethodUsage.MULTI_USE, NOT SINGLE_USE — Braintree's own
 * Venmo docs are explicit that vaulting requires MULTI_USE: "If
 * VenmoPaymentMethodUsage is set to SINGLE_USE: A validation error will be
 * returned if attempting to vault via PaymentMethod.create or
 * Customer.create." totalAmount is intentionally omitted — the docs confirm
 * it's "required in the context of purchase" but "can be omitted" for a
 * vaulting-only tokenize call, which is exactly this screen.
 *
 * Own App Link path / fallback scheme (shared/ReturnUrls.kt), and — same
 * lesson learned from today's One Time Payment > Venmo debugging — the
 * pending request is persisted to SharedPreferences rather than kept
 * in-memory, since Venmo's round trip can outlive the process.
 *
 * On success, tokenizes to a nonce and POSTs to /api/vault/store — no
 * gateway.transaction.sale call, zero dollars move.
 */
class StoreVenmoActivity : ComponentActivity() {

    private val diagnostics = DiagnosticsLog()
    private val prefs by lazy { getSharedPreferences("bt_demo_store_venmo", MODE_PRIVATE) }

    private lateinit var venmoButton: MaterialButton

    private lateinit var venmoLauncher: VenmoLauncher
    private var venmoClient: VenmoClient? = null

    private var pendingRequestString: String?
        get() = prefs.getString("pending", null)
        set(value) { prefs.edit().putString("pending", value).apply() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applyImeInsetsAsPadding()
        setContentView(R.layout.activity_vaultstore_venmo)

        diagnostics.bind(findViewById<TextView>(R.id.logText))
        venmoButton = findViewById(R.id.venmoButton)
        venmoButton.iconTint = null

        venmoLauncher = VenmoLauncher()
        venmoButton.setOnClickListener { hideKeyboard(); startVenmoVault() }

        loadClientTokenAndInitClient()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleVenmoReturn(intent)
    }

    override fun onResume() {
        super.onResume()
        handleVenmoReturn(intent)
    }

    private fun loadClientTokenAndInitClient() {
        lifecycleScope.launch {
            diagnostics.info("Fetching client token…")
            val token = ApiClient.fetchClientToken().getOrNull()
            if (token == null) {
                diagnostics.error("Failed to fetch client token")
                return@launch
            }
            diagnostics.success("Got client token")

            venmoClient = VenmoClient(
                context = this@StoreVenmoActivity,
                authorization = token,
                appLinkReturnUrl = ReturnUrls.storeVenmoAppLink(),
                deepLinkFallbackUrlScheme = ReturnUrls.storeVenmoFallbackScheme(packageName)
            )

            venmoButton.isEnabled = true
        }
    }

    private fun startVenmoVault() {
        val client = venmoClient ?: run {
            diagnostics.warn("Still initializing (no client token yet).")
            return
        }

        // MULTI_USE required for vaulting; totalAmount intentionally omitted
        // (only required "in the context of purchase" per Braintree's docs).
        val request = VenmoRequest(paymentMethodUsage = VenmoPaymentMethodUsage.MULTI_USE)

        diagnostics.info("Requesting Venmo authorization (vault only, no charge)…")

        client.createPaymentAuthRequest(this, request) { authRequest ->
            when (authRequest) {
                is VenmoPaymentAuthRequest.Failure ->
                    diagnostics.error("Venmo auth request failed: ${authRequest.error.message}")
                is VenmoPaymentAuthRequest.ReadyToLaunch -> {
                    when (val pending = venmoLauncher.launch(this, authRequest)) {
                        is VenmoPendingRequest.Started -> {
                            pendingRequestString = pending.pendingRequestString
                            diagnostics.info("Venmo launched; pending request persisted.")
                        }
                        is VenmoPendingRequest.Failure ->
                            diagnostics.error("Venmo launch failed: ${pending.error.message}")
                    }
                }
            }
        }
    }

    private fun handleVenmoReturn(intent: Intent) {
        val client = venmoClient ?: return
        val pendingString = pendingRequestString ?: return
        val pending = VenmoPendingRequest.Started(pendingString)

        when (val authResult = venmoLauncher.handleReturnToApp(pending, intent)) {
            is VenmoPaymentAuthResult.NoResult ->
                diagnostics.warn("Venmo handleReturnToApp: NoResult (not our return, or user canceled).")
            is VenmoPaymentAuthResult.Failure -> {
                diagnostics.error("Venmo return failure: ${authResult.error.message}")
                pendingRequestString = null
            }
            is VenmoPaymentAuthResult.Success -> {
                diagnostics.success("Venmo auth success; tokenizing…")
                client.tokenize(authResult) { result ->
                    when (result) {
                        is VenmoResult.Cancel -> diagnostics.warn("Venmo canceled.")
                        is VenmoResult.Failure -> diagnostics.error("Venmo tokenize failed: ${result.error.message}")
                        is VenmoResult.Success -> {
                            val nonce = result.nonce.string
                            diagnostics.success("Venmo nonce: $nonce")
                            storeInVault(nonce)
                        }
                    }
                }
                pendingRequestString = null
                intent.data = null
            }
        }
    }

    private fun storeInVault(nonce: String) {
        lifecycleScope.launch {
            diagnostics.info("Storing in vault (no charge)…")
            ApiClient.vaultStore(paymentMethodNonce = nonce)
                .onSuccess { diagnostics.raw("Server response:\n$it") }
                .onFailure { diagnostics.error("Server call failed: ${it.message}") }
        }
    }
}
