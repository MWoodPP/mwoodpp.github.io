package com.example.woodsbxbraintree.checkoutwithvault

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
 * Checkout with Vault > PayPal + Vault.
 *
 * IMPORTANT — CONFIRMED PLATFORM LIMITATION, NOT A BUG:
 * This screen will ALWAYS open PayPal in a browser/Custom Tab, never a true
 * App Switch to the installed PayPal app, no matter what flags are set.
 * Braintree's own official App Switch guide states this explicitly:
 *   "App Switch is not supported for One-time 'Continue' flow or
 *    Vaulting with Purchase flow."
 * "Vaulting with Purchase" is exactly this flow — charging AND vaulting in
 * the same PayPal approval. enablePayPalAppSwitch is still left set to true
 * below (harmless, and future-proofs against Braintree lifting this
 * restriction later), but don't expect it to actually switch to the app on
 * this screen specifically. Only pure One Time Payment > PayPal and pure
 * Vault > Store: PayPal are eligible for real App Switch.
 *
 * Otherwise: same checkout flow as One Time Payment > PayPal, but the final
 * /checkout call passes storeInVaultOnSuccess = true plus a customer, so the
 * server vaults the PayPal account under a new customer as part of the same
 * sale. Own App Link path / fallback scheme (shared/ReturnUrls.kt) — still
 * needed for the web-flow return, even without App Switch.
 */
class PayPalVaultActivity : ComponentActivity() {

    private val diagnostics = DiagnosticsLog()
    private val prefs by lazy { getSharedPreferences("bt_demo_checkoutvault_paypal", MODE_PRIVATE) }

    private lateinit var amountEdit: TextInputEditText
    private lateinit var firstNameEdit: TextInputEditText
    private lateinit var lastNameEdit: TextInputEditText
    private lateinit var emailEdit: TextInputEditText
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
        setContentView(R.layout.activity_vaultcheckout_paypal)

        diagnostics.bind(findViewById<TextView>(R.id.logText))
        amountEdit = findViewById(R.id.amountEdit)
        firstNameEdit = findViewById(R.id.firstNameEdit)
        lastNameEdit = findViewById(R.id.lastNameEdit)
        emailEdit = findViewById(R.id.emailEdit)
        payPalButton = findViewById(R.id.payPalButton)
        payPalButton.iconTint = null

        payPalLauncher = PayPalLauncher()
        payPalButton.setOnClickListener { hideKeyboard(); startPayPalCheckoutWithVault() }

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

            dataCollector = DataCollector(this@PayPalVaultActivity, token)
            payPalClient = PayPalClient(
                context = this@PayPalVaultActivity,
                authorization = token,
                appLinkReturnUrl = ReturnUrls.checkoutVaultPayPalAppLink(),
                deepLinkFallbackUrlScheme = ReturnUrls.checkoutVaultPayPalFallbackScheme(packageName)
            )

            payPalButton.isEnabled = true
        }
    }

    private fun amount(): String = amountEdit.text?.toString().orEmpty().ifBlank { "12.34" }

    private fun startPayPalCheckoutWithVault() {
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
            userAuthenticationEmail = emailEdit.text?.toString()?.ifBlank { null } ?: "buyer@example.com"
            userPhoneNumber = PayPalPhoneNumber("1", "2223334444")
            shouldOfferPayLater = false
            // THE FIX: confirmed against Braintree's official "Checkout with
            // Vault" guide — this is the Android equivalent of the JS SDK's
            // `requestBillingAgreement = true`. Without this, PayPal is
            // never asked for vault consent during approval, so the
            // server's storeInVaultOnSuccess has nothing to actually vault
            // (transaction still succeeds as a plain one-time sale, which
            // is exactly the "still just OTP" behavior observed in testing —
            // confirmed by vaultedPaymentMethodToken/vaultedCustomerId both
            // coming back null).
            shouldRequestBillingAgreement = true
        }

        diagnostics.info("Requesting PayPal auth (expect browser flow — App Switch is not supported for Vaulting with Purchase)…")

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
                            collectDeviceDataAndPay(nonce)
                        }
                    }
                }
                pendingRequestString = null
                intent.data = null
            }
        }
    }

    private fun collectDeviceDataAndPay(nonce: String) {
        val collector = dataCollector
        if (collector == null) {
            createTransactionAndVault(nonce, deviceData = null)
            return
        }
        val req = DataCollectorRequest(hasUserLocationConsent = false)
        collector.collectDeviceData(this, req) { result ->
            when (result) {
                is DataCollectorResult.Success -> createTransactionAndVault(nonce, result.deviceData)
                is DataCollectorResult.Failure -> {
                    diagnostics.warn("deviceData failed: ${result.error.message}")
                    createTransactionAndVault(nonce, null)
                }
            }
        }
    }

    private fun createTransactionAndVault(nonce: String, deviceData: String?) {
        val amt = amount()
        val firstName = firstNameEdit.text?.toString().orEmpty().ifBlank { null }
        val lastName = lastNameEdit.text?.toString().orEmpty().ifBlank { null }
        val email = emailEdit.text?.toString().orEmpty().ifBlank { null }

        lifecycleScope.launch {
            diagnostics.info("Sending to server: amount=$amt, storeInVaultOnSuccess=true")
            ApiClient.checkout(
                amount = amt,
                paymentMethodNonce = nonce,
                deviceData = deviceData,
                storeInVaultOnSuccess = true,
                customerFirstName = firstName,
                customerLastName = lastName,
                customerEmail = email
            ).onSuccess { diagnostics.raw("Server response:\n$it") }
                .onFailure { diagnostics.error("Server call failed: ${it.message}") }
        }
    }
}
