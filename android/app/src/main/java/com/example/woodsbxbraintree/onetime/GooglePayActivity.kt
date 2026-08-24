package com.example.woodsbxbraintree.onetime

import android.os.Bundle
import android.view.View
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import com.braintreepayments.api.datacollector.DataCollector
import com.braintreepayments.api.datacollector.DataCollectorRequest
import com.braintreepayments.api.datacollector.DataCollectorResult
import com.braintreepayments.api.googlepay.GooglePayClient
import com.braintreepayments.api.googlepay.GooglePayLauncher
import com.braintreepayments.api.googlepay.GooglePayPaymentAuthRequest
import com.braintreepayments.api.googlepay.GooglePayPaymentAuthResult
import com.braintreepayments.api.googlepay.GooglePayReadinessResult
import com.braintreepayments.api.googlepay.GooglePayRequest
import com.braintreepayments.api.googlepay.GooglePayResult
import com.braintreepayments.api.googlepay.GooglePayTotalPriceStatus
import com.example.woodsbxbraintree.R
import com.example.woodsbxbraintree.shared.applyImeInsetsAsPadding
import com.example.woodsbxbraintree.shared.hideKeyboard
import com.example.woodsbxbraintree.shared.ApiClient
import com.example.woodsbxbraintree.shared.DiagnosticsLog
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import kotlinx.coroutines.launch

/**
 * One Time Payment > Google Pay.
 *
 * Confirmed working end-to-end (8/14) after correcting a few API surface
 * mismatches against Braintree's real v5 docs:
 * https://developer.paypal.com/braintree/docs/guides/google-pay/client-side/android/v5/
 *   - GooglePayRequest takes named constructor params (currencyCode,
 *     totalPrice, totalPriceStatus) — not TransactionInfo/WalletConstants
 *     (the old v3/v4 pattern).
 *   - totalPriceStatus uses Braintree's own GooglePayTotalPriceStatus enum.
 *   - createPaymentAuthRequest(request, callback) takes NO activity param.
 *   - GooglePayReadinessResult is a sealed class with exactly TWO members —
 *     ReadyToPay (data object) and NotReadyToPay (class) — no separate
 *     Failure case, so this checks only for ReadyToPay.
 *   - GooglePayPaymentAuthResult (the launcher callback's result) is NOT
 *     meant to be pattern-matched — pass it straight into tokenize()
 *     unexamined; only the tokenize result (GooglePayResult) has the
 *     public Success/Failure/Cancel cases.
 */
class GooglePayActivity : ComponentActivity() {

    private val diagnostics = DiagnosticsLog()

    private lateinit var amountEdit: TextInputEditText
    private lateinit var googlePayButton: MaterialButton
    private lateinit var readinessText: TextView

    private var googlePayClient: GooglePayClient? = null
    private var dataCollector: DataCollector? = null

    // GooglePayLauncher wraps an ActivityResultLauncher internally, so per
    // Android's rules it MUST be constructed unconditionally in onCreate
    // (before the Activity reaches STARTED) — confirmed by the official guide.
    private lateinit var googlePayLauncher: GooglePayLauncher

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applyImeInsetsAsPadding()
        setContentView(R.layout.activity_onetime_googlepay)

        diagnostics.bind(findViewById<TextView>(R.id.logText))
        amountEdit = findViewById(R.id.amountEdit)
        googlePayButton = findViewById(R.id.googlePayButton)
        readinessText = findViewById(R.id.readinessText)

        // Google Pay's result comes back through this callback directly —
        // no manual intent parsing needed, unlike PayPal/Venmo.
        googlePayLauncher = GooglePayLauncher(this) { result -> handleGooglePayResult(result) }

        googlePayButton.setOnClickListener { hideKeyboard(); startGooglePay() }

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

            dataCollector = DataCollector(this@GooglePayActivity, token)
            val client = GooglePayClient(this@GooglePayActivity, token)
            googlePayClient = client

            client.isReadyToPay(this@GooglePayActivity) { readiness ->
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

    private fun amount(): String = amountEdit.text?.toString().orEmpty().ifBlank { "12.34" }

    private fun startGooglePay() {
        val client = googlePayClient ?: run {
            diagnostics.warn("Still initializing (no client token yet).")
            return
        }

        val request = GooglePayRequest(
            currencyCode = "USD",
            totalPrice = amount(),
            totalPriceStatus = GooglePayTotalPriceStatus.TOTAL_PRICE_STATUS_FINAL
        ).apply {
            isEmailRequired = false
            isBillingAddressRequired = false
        }

        diagnostics.info("Requesting Google Pay sheet…")

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
    // the public Success/Failure/Cancel cases.
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
                    collectDeviceDataAndCheckout(nonce)
                }
            }
        }
    }

    private fun collectDeviceDataAndCheckout(nonce: String) {
        val collector = dataCollector
        if (collector == null) {
            createTransaction(nonce, deviceData = null)
            return
        }
        val req = DataCollectorRequest(hasUserLocationConsent = false)
        collector.collectDeviceData(this, req) { result ->
            when (result) {
                is DataCollectorResult.Success -> createTransaction(nonce, result.deviceData)
                is DataCollectorResult.Failure -> {
                    diagnostics.warn("deviceData failed: ${result.error.message}")
                    createTransaction(nonce, null)
                }
            }
        }
    }

    private fun createTransaction(nonce: String, deviceData: String?) {
        val amt = amount()
        lifecycleScope.launch {
            diagnostics.info("Sending to server: amount=$amt")
            ApiClient.checkout(amount = amt, paymentMethodNonce = nonce, deviceData = deviceData)
                .onSuccess { diagnostics.raw("Server response:\n$it") }
                .onFailure { diagnostics.error("Server call failed: ${it.message}") }
        }
    }
}
