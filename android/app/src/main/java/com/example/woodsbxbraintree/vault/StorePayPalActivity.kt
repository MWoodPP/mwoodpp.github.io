package com.example.woodsbxbraintree.vault

import android.content.Intent
import android.os.Bundle
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import com.braintreepayments.api.paypal.PayPalClient
import com.braintreepayments.api.paypal.PayPalLauncher
import com.braintreepayments.api.paypal.PayPalPaymentAuthRequest
import com.braintreepayments.api.paypal.PayPalPaymentAuthResult
import com.braintreepayments.api.paypal.PayPalPaymentUserAction
import com.braintreepayments.api.paypal.PayPalPendingRequest
import com.braintreepayments.api.paypal.PayPalResult
import com.braintreepayments.api.paypal.PayPalVaultRequest
import com.example.woodsbxbraintree.R
import com.example.woodsbxbraintree.shared.applyImeInsetsAsPadding
import com.example.woodsbxbraintree.shared.hideKeyboard
import com.example.woodsbxbraintree.shared.ApiClient
import com.example.woodsbxbraintree.shared.DiagnosticsLog
import com.example.woodsbxbraintree.shared.ReturnUrls
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import kotlinx.coroutines.launch

/**
 * Vault > Store: PayPal.
 *
 * Uses PayPalVaultRequest (billing agreement / "flow: vault"), NOT
 * PayPalCheckoutRequest — no charge happens, this only sets up the PayPal
 * account for future use.
 *
 * IMPORTANT enum difference from the one-time/checkout-with-vault PayPal
 * screens: those use userAction = USER_ACTION_COMMIT, which per the SDK's
 * own doc comment "only works for the PayPal Checkout flow." For the Vault
 * flow, the matching deterministic-CTA constant is USER_ACTION_SETUP_NOW
 * ("Setup Now" button text) — using COMMIT here would be the wrong enum
 * value for this flow.
 *
 * On success, tokenizes to a nonce and POSTs to /api/vault/store — no
 * gateway.transaction.sale call, zero dollars move.
 */
class StorePayPalActivity : ComponentActivity() {

    private val diagnostics = DiagnosticsLog()
    private val prefs by lazy { getSharedPreferences("bt_demo_store_paypal", MODE_PRIVATE) }

    private lateinit var firstNameEdit: TextInputEditText
    private lateinit var lastNameEdit: TextInputEditText
    private lateinit var emailEdit: TextInputEditText
    private lateinit var payPalButton: MaterialButton

    private lateinit var payPalLauncher: PayPalLauncher
    private var payPalClient: PayPalClient? = null

    private var pendingRequestString: String?
        get() = prefs.getString("pending", null)
        set(value) { prefs.edit().putString("pending", value).apply() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applyImeInsetsAsPadding()
        setContentView(R.layout.activity_vaultstore_paypal)

        diagnostics.bind(findViewById<TextView>(R.id.logText))
        firstNameEdit = findViewById(R.id.firstNameEdit)
        lastNameEdit = findViewById(R.id.lastNameEdit)
        emailEdit = findViewById(R.id.emailEdit)
        payPalButton = findViewById(R.id.payPalButton)
        payPalButton.iconTint = null

        payPalLauncher = PayPalLauncher()
        payPalButton.setOnClickListener { hideKeyboard(); startPayPalVault() }

        loadClientTokenAndInitClients()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handlePayPalReturn(intent)
    }

    override fun onResume() {
        super.onResume()
        handlePayPalReturn(intent)
    }

    private fun loadClientTokenAndInitClients() {
        lifecycleScope.launch {
            diagnostics.info("Fetching client token…")
            val token = ApiClient.fetchClientToken().getOrNull()
            if (token == null) {
                diagnostics.error("Failed to fetch client token")
                return@launch
            }
            diagnostics.success("Got client token")

            payPalClient = PayPalClient(
                context = this@StorePayPalActivity,
                authorization = token,
                appLinkReturnUrl = ReturnUrls.storePayPalAppLink(),
                deepLinkFallbackUrlScheme = ReturnUrls.storePayPalFallbackScheme(packageName)
            )

            payPalButton.isEnabled = true
        }
    }

    private fun startPayPalVault() {
        val client = payPalClient ?: run {
            diagnostics.warn("Still initializing (no client token yet).")
            return
        }

        val request = PayPalVaultRequest(
            hasUserLocationConsent = true
        ).apply {
            enablePayPalAppSwitch = true
            userAction = PayPalPaymentUserAction.USER_ACTION_SETUP_NOW
            localeCode = "en-US"
        }

        diagnostics.info("Requesting PayPal vault auth (App Switch enabled)…")

        client.createPaymentAuthRequest(this, request) { authRequest ->
            when (authRequest) {
                is PayPalPaymentAuthRequest.Failure ->
                    diagnostics.error("PayPal auth request failed: ${authRequest.error.message}")
                is PayPalPaymentAuthRequest.ReadyToLaunch -> {
                    when (val pending = payPalLauncher.launch(this, authRequest)) {
                        is PayPalPendingRequest.Started -> {
                            pendingRequestString = pending.pendingRequestString
                            diagnostics.info("PayPal launched; pending request stored.")
                        }
                        is PayPalPendingRequest.Failure ->
                            diagnostics.error("PayPal launch failed: ${pending.error.message}")
                    }
                }
            }
        }
    }

    private fun handlePayPalReturn(intent: Intent) {
        val client = payPalClient ?: return
        val pendingString = pendingRequestString ?: return

        when (val authResult = payPalLauncher.handleReturnToApp(
            pendingRequest = PayPalPendingRequest.Started(pendingString),
            intent = intent
        )) {
            is PayPalPaymentAuthResult.NoResult -> { /* not our return, or user canceled */ }
            is PayPalPaymentAuthResult.Failure -> {
                diagnostics.error("PayPal return failure: ${authResult.error.message}")
                pendingRequestString = null
            }
            is PayPalPaymentAuthResult.Success -> {
                diagnostics.success("PayPal auth success; tokenizing…")
                client.tokenize(authResult) { result ->
                    when (result) {
                        is PayPalResult.Cancel -> diagnostics.warn("PayPal canceled.")
                        is PayPalResult.Failure -> diagnostics.error("PayPal tokenize failed: ${result.error.message}")
                        is PayPalResult.Success -> {
                            val nonce = result.nonce.string
                            diagnostics.success("PayPal nonce: $nonce")
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
        val firstName = firstNameEdit.text?.toString().orEmpty().ifBlank { null }
        val lastName = lastNameEdit.text?.toString().orEmpty().ifBlank { null }
        val email = emailEdit.text?.toString().orEmpty().ifBlank { null }

        lifecycleScope.launch {
            diagnostics.info("Storing in vault (no charge)…")
            ApiClient.vaultStore(
                paymentMethodNonce = nonce,
                customerFirstName = firstName,
                customerLastName = lastName,
                customerEmail = email
            ).onSuccess { diagnostics.raw("Server response:\n$it") }
                .onFailure { diagnostics.error("Server call failed: ${it.message}") }
        }
    }
}
