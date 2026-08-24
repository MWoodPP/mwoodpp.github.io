package com.example.woodsbxbraintree.onetime

import android.content.Intent
import android.os.Bundle
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import com.braintreepayments.api.datacollector.DataCollector
import com.braintreepayments.api.datacollector.DataCollectorRequest
import com.braintreepayments.api.datacollector.DataCollectorResult
import com.braintreepayments.api.venmo.VenmoClient
import com.braintreepayments.api.venmo.VenmoLauncher
import com.braintreepayments.api.venmo.VenmoPaymentAuthRequest
import com.braintreepayments.api.venmo.VenmoPaymentAuthResult
import com.braintreepayments.api.venmo.VenmoPaymentMethodUsage
import com.braintreepayments.api.venmo.VenmoPendingRequest
import com.braintreepayments.api.venmo.VenmoRequest
import com.braintreepayments.api.venmo.VenmoResult
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
 * One Time Payment > Venmo.
 *
 * Own App Link path / fallback scheme (shared/ReturnUrls.kt) so the
 * return-to-app deep link routes here specifically.
 *
 * CONFIRMED (Braintree SDK team, internal #service-pw-venmo, 8/2026): the
 * native Android SDK hardcodes a check for the exact installed package
 * "com.venmo" before attempting App Switch. No sandbox-variant Venmo app
 * will ever trigger it — this is by design, not a bug. Testing App Switch
 * here requires the REAL production Venmo app installed and a REAL
 * personal Venmo account logged in (not a qa.venmo.com test account). If
 * those aren't both true, falling back to the browser flow is expected.
 */
class VenmoActivity : ComponentActivity() {

    private val diagnostics = DiagnosticsLog()
    private val prefs by lazy { getSharedPreferences("bt_demo_onetime_venmo", MODE_PRIVATE) }

    private lateinit var amountEdit: TextInputEditText
    private lateinit var venmoButton: MaterialButton

    private lateinit var venmoLauncher: VenmoLauncher
    private var venmoClient: VenmoClient? = null
    private var dataCollector: DataCollector? = null

    // ROOT CAUSE OF THE "no redirect, no result" BUG (found via Logcat trace
    // 8/14, tag BTDemo): this used to be a plain in-memory var. Venmo can
    // keep the app backgrounded long enough that Android kills the process
    // to reclaim memory. When the user switches back, Android creates a
    // BRAND-NEW VenmoActivity instance — an in-memory var comes back null,
    // so handleVenmoReturn()'s `pendingRequest ?: return` silently gives up
    // even though Venmo/Android correctly delivered the return Intent. Fixed
    // by persisting to SharedPreferences, exactly like PayPalActivity/
    // PayPalVaultActivity/StorePayPalActivity already do successfully.
    //
    // UNCONFIRMED FIELD NAME — verify via Cmd+B if this doesn't compile:
    // VenmoPendingRequest.Started.pendingRequestString is assumed by direct
    // analogy with PayPalPendingRequest.Started (explicitly documented at
    // developer.paypal.com/braintree/docs/guides/paypal/vault/android/v5),
    // since Card/PayPal/Venmo all shipped together in SDK 5.24.0 with an
    // identical Client/Launcher/Request/Result architecture. Braintree's own
    // Venmo docs say only "store the pending request for later" without
    // naming the concrete property — likely a docs omission, not a real
    // API difference, but worth a quick check if this field doesn't exist.
    private var pendingRequestString: String?
        get() = prefs.getString("pending", null)
        set(value) { prefs.edit().putString("pending", value).apply() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applyImeInsetsAsPadding()
        setContentView(R.layout.activity_onetime_venmo)

        diagnostics.bind(findViewById<TextView>(R.id.logText))
        amountEdit = findViewById(R.id.amountEdit)
        venmoButton = findViewById(R.id.venmoButton)
        venmoButton.iconTint = null

        venmoLauncher = VenmoLauncher()
        venmoButton.setOnClickListener { hideKeyboard(); startVenmo() }

        loadClientTokenAndInitClients()
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

    private fun loadClientTokenAndInitClients() {
        lifecycleScope.launch {
            diagnostics.info("Fetching client token…")
            val token = ApiClient.fetchClientToken().getOrNull()
            if (token == null) {
                diagnostics.error("Failed to fetch client token")
                return@launch
            }
            diagnostics.success("Got client token")

            dataCollector = DataCollector(this@VenmoActivity, token)
            venmoClient = VenmoClient(
                context = this@VenmoActivity,
                authorization = token,
                appLinkReturnUrl = ReturnUrls.oneTimeVenmoAppLink(),
                deepLinkFallbackUrlScheme = ReturnUrls.oneTimeVenmoFallbackScheme(packageName)
            )

            venmoButton.isEnabled = true
        }
    }

    private fun amount(): String = amountEdit.text?.toString().orEmpty().ifBlank { "12.34" }

    private fun startVenmo() {
        val client = venmoClient ?: run {
            diagnostics.warn("Still initializing (no client token yet).")
            return
        }

        val request = VenmoRequest(
            paymentMethodUsage = VenmoPaymentMethodUsage.SINGLE_USE
        ).apply {
            totalAmount = amount()
            isFinalAmount = true
        }

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
        val pendingString = pendingRequestString
        diagnostics.info("handleVenmoReturn called — pendingRequestString=${if (pendingString != null) "present" else "NULL"}, intent.data=${intent.data}")

        if (pendingString == null) {
            diagnostics.warn("No pending Venmo request found — nothing to resume.")
            return
        }
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
