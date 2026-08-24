package com.example.woodsbxbraintree.vault

import android.os.Bundle
import android.view.View
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import com.braintreepayments.api.googlepay.GooglePayClient
import com.braintreepayments.api.googlepay.GooglePayLauncher
import com.braintreepayments.api.googlepay.GooglePayPaymentAuthRequest
import com.braintreepayments.api.googlepay.GooglePayPaymentAuthResult
import com.braintreepayments.api.googlepay.GooglePayReadinessResult
import com.braintreepayments.api.googlepay.GooglePayRequest
import com.braintreepayments.api.googlepay.GooglePayResult
import com.braintreepayments.api.googlepay.GooglePayTotalPriceStatus
import com.example.woodsbxbraintree.R
import com.example.woodsbxbraintree.shared.ApiClient
import com.example.woodsbxbraintree.shared.DiagnosticsLog
import com.example.woodsbxbraintree.shared.applyImeInsetsAsPadding
import com.example.woodsbxbraintree.shared.hideKeyboard
import com.google.android.material.button.MaterialButton
import kotlinx.coroutines.launch

/**
 * Vault > Store: Google Pay.
 *
 * Same confirmed-working API surface as One Time Payment > Google Pay — see
 * that file's comments for the full corrections history against Braintree's
 * real v5 docs.
 *
 * There is no dedicated "vault-only" mode for Google Pay the way PayPal has
 * PayPalVaultRequest — Google Pay's docs confirm the vaulting mechanism is
 * simply: tokenize normally, then send the resulting nonce to
 * gateway.customer.create instead of gateway.transaction.sale ("If using a
 * client token with a customer id, the Google Pay card will not
 * automatically be vaulted. You can use the payment method nonce to create
 * a payment method on your server."). The payment sheet still requires a
 * totalPrice to render at all, so a small nominal placeholder amount is
 * used here since it's never actually charged — it's only sent to
 * /api/vault/store, never /checkout.
 */
class StoreGooglePayActivity : ComponentActivity() {

    private val diagnostics = DiagnosticsLog()

    private lateinit var googlePayButton: MaterialButton
    private lateinit var readinessText: TextView

    private var googlePayClient: GooglePayClient? = null
    private lateinit var googlePayLauncher: GooglePayLauncher

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applyImeInsetsAsPadding()
        setContentView(R.layout.activity_vaultstore_googlepay)

        diagnostics.bind(findViewById<TextView>(R.id.logText))
        googlePayButton = findViewById(R.id.googlePayButton)
        readinessText = findViewById(R.id.readinessText)

        googlePayLauncher = GooglePayLauncher(this) { result -> handleGooglePayResult(result) }
        googlePayButton.setOnClickListener { hideKeyboard(); startGooglePayVault() }

        loadClientTokenAndInitClient()
    }

    private fun loadClientTokenAndInitClient() {
        lifecycleScope.launch {
            diagnostics.info("Fetching client token…")
            val token = ApiClient.fetchClientToken().getOrNull()
            if (token == null) {
                diagnostics.error("Failed to fetch client token")
                readinessText.text = "Could not initialize (no client token)."
                return@launch
            }
            diagnostics.success("Got client token")

            val client = GooglePayClient(this@StoreGooglePayActivity, token)
            googlePayClient = client

            client.isReadyToPay(this@StoreGooglePayActivity) { readiness ->
                if (readiness is GooglePayReadinessResult.ReadyToPay) {
                    readinessText.text = "Google Pay is ready on this device."
                    googlePayButton.visibility = View.VISIBLE
                    diagnostics.success("Google Pay ready")
                } else {
                    readinessText.text = "Google Pay is not available on this device/account."
                    diagnostics.warn("Google Pay not ready: $readiness")
                }
            }
        }
    }

    private fun startGooglePayVault() {
        val client = googlePayClient ?: run {
            diagnostics.warn("Still initializing (no client token yet).")
            return
        }

        // Display-only placeholder — never charged, only used to satisfy
        // the Google Pay sheet's required totalPrice field. ESTIMATED
        // (not FINAL) since no actual transaction happens. Using a small
        // nominal amount rather than "0.00" — Google Pay's own validation
        // may reject a literal zero amount even though nothing here is
        // ever actually sent to gateway.transaction.sale.
        val request = GooglePayRequest(
            currencyCode = "USD",
            totalPrice = "1.00",
            totalPriceStatus = GooglePayTotalPriceStatus.TOTAL_PRICE_STATUS_ESTIMATED
        ).apply {
            isEmailRequired = false
            isBillingAddressRequired = false
        }

        diagnostics.info("Requesting Google Pay sheet (vault only, no charge)…")

        client.createPaymentAuthRequest(request) { authRequest ->
            when (authRequest) {
                is GooglePayPaymentAuthRequest.Failure ->
                    diagnostics.error("Google Pay auth request failed: ${authRequest.error.message}")
                is GooglePayPaymentAuthRequest.ReadyToLaunch -> {
                    diagnostics.info("Launching Google Pay sheet…")
                    googlePayLauncher.launch(authRequest)
                }
            }
        }
    }

    // GooglePayPaymentAuthResult (what the launcher callback delivers) is NOT
    // meant to be pattern-matched by app code — its members are internal.
    // Per Braintree's own v5 migration guide, you pass it straight into
    // tokenize() unexamined; only the TOKENIZE result (GooglePayResult) has
    // the public Success/Failure/Cancel cases. (Same fix already applied to
    // GooglePayActivity.kt earlier — copy-pasted the old unfixed version
    // into this file by mistake.)
    private fun handleGooglePayResult(result: GooglePayPaymentAuthResult) {
        val client = googlePayClient ?: return
        client.tokenize(result) { tokenizeResult ->
            when (tokenizeResult) {
                is GooglePayResult.Cancel -> diagnostics.warn("Google Pay canceled.")
                is GooglePayResult.Failure ->
                    diagnostics.error("Google Pay tokenize failed: ${tokenizeResult.error.message}")
                is GooglePayResult.Success -> {
                    val nonce = tokenizeResult.nonce.string
                    diagnostics.success("Google Pay nonce: $nonce")
                    storeInVault(nonce)
                }
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
