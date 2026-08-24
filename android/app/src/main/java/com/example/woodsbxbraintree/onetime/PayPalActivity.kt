package com.example.woodsbxbraintree.onetime

import android.content.Intent
import android.os.Bundle
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import com.braintreepayments.api.datacollector.DataCollector
import com.braintreepayments.api.datacollector.DataCollectorRequest
import com.braintreepayments.api.datacollector.DataCollectorResult
import com.braintreepayments.api.paypal.PayPalCheckoutRequest
import com.braintreepayments.api.paypal.PayPalClient
import com.braintreepayments.api.paypal.PayPalLauncher
import com.braintreepayments.api.paypal.PayPalPaymentAuthRequest
import com.braintreepayments.api.paypal.PayPalPaymentAuthResult
import com.braintreepayments.api.paypal.PayPalPaymentUserAction
import com.braintreepayments.api.paypal.PayPalPendingRequest
import com.braintreepayments.api.paypal.PayPalPhoneNumber
import com.braintreepayments.api.paypal.PayPalResult
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
 * One Time Payment > PayPal.
 *
 * Uses the App Switch fix confirmed working earlier today:
 *   - enablePayPalAppSwitch = true
 *   - userAction = PayPalPaymentUserAction.USER_ACTION_COMMIT
 *     (the real enum constant — NOT USER_ACTION_PAY_NOW, despite what the
 *     App Switch guide's prose implies)
 *
 * This screen has its own App Link path / fallback scheme (see
 * shared/ReturnUrls.kt) so the return-to-app deep link routes here and not
 * to any of the other three PayPal/Venmo screens in the suite.
 */
class PayPalActivity : ComponentActivity() {

    private val diagnostics = DiagnosticsLog()
    private val prefs by lazy { getSharedPreferences("bt_demo_onetime_paypal", MODE_PRIVATE) }

    private lateinit var amountEdit: TextInputEditText
    private lateinit var payPalButton: MaterialButton

    private lateinit var payPalLauncher: PayPalLauncher
    private var payPalClient: PayPalClient? = null
    private var dataCollector: DataCollector? = null

    private var pendingRequestString: String?
        get() = prefs.getString("pending", null)
        set(value) { prefs.edit().putString("pending", value).apply() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applyImeInsetsAsPadding()
        setContentView(R.layout.activity_onetime_paypal)

        diagnostics.bind(findViewById<TextView>(R.id.logText))
        amountEdit = findViewById(R.id.amountEdit)
        payPalButton = findViewById(R.id.payPalButton)
        payPalButton.iconTint = null

        payPalLauncher = PayPalLauncher()
        payPalButton.setOnClickListener { hideKeyboard(); startPayPalOneTime() }

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

            dataCollector = DataCollector(this@PayPalActivity, token)
            payPalClient = PayPalClient(
                context = this@PayPalActivity,
                authorization = token,
                appLinkReturnUrl = ReturnUrls.oneTimePayPalAppLink(),
                deepLinkFallbackUrlScheme = ReturnUrls.oneTimePayPalFallbackScheme(packageName)
            )

            payPalButton.isEnabled = true
        }
    }

    private fun amount(): String = amountEdit.text?.toString().orEmpty().ifBlank { "12.34" }

    private fun startPayPalOneTime() {
        val client = payPalClient ?: run {
            diagnostics.warn("Still initializing (no client token yet).")
            return
        }

        val request = PayPalCheckoutRequest(
            amount = amount(),
            hasUserLocationConsent = true
        ).apply {
            enablePayPalAppSwitch = true
            userAction = PayPalPaymentUserAction.USER_ACTION_COMMIT
            userAuthenticationEmail = "buyer@example.com"
            userPhoneNumber = PayPalPhoneNumber("1", "2223334444")
            shouldOfferPayLater = false
        }

        diagnostics.info("Requesting PayPal auth (App Switch enabled)…")

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
                            collectDeviceDataAndCheckout(nonce)
                        }
                    }
                }
                pendingRequestString = null
                intent.data = null
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
