package com.example.woodsbxbraintree.checkoutwithvault

import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.widget.doAfterTextChanged
import androidx.lifecycle.lifecycleScope
import com.braintreepayments.api.card.Card
import com.braintreepayments.api.card.CardClient
import com.braintreepayments.api.card.CardResult
import com.braintreepayments.api.datacollector.DataCollector
import com.braintreepayments.api.datacollector.DataCollectorRequest
import com.braintreepayments.api.datacollector.DataCollectorResult
import com.example.woodsbxbraintree.R
import com.example.woodsbxbraintree.shared.applyImeInsetsAsPadding
import com.example.woodsbxbraintree.shared.hideKeyboard
import com.example.woodsbxbraintree.shared.ApiClient
import com.example.woodsbxbraintree.shared.CardValidation
import com.example.woodsbxbraintree.shared.DiagnosticsLog
import com.example.woodsbxbraintree.shared.setValidationState
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import kotlinx.coroutines.launch

/**
 * Checkout with Vault > Card + Vault.
 *
 * Same card tokenization as One Time Payment > Card, but the /checkout call
 * passes storeInVaultOnSuccess = true plus a customer, so the server's
 * gateway.transaction.sale(...) both charges the card AND vaults it under a
 * new customer in the same call. See server.js diff: /checkout was extended
 * to accept storeInVaultOnSuccess/customerId/customer — this did not exist
 * in the server.js you shared, so make sure that change is applied.
 */
class CardVaultActivity : ComponentActivity() {

    private val diagnostics = DiagnosticsLog()

    private lateinit var amountEdit: TextInputEditText
    private lateinit var cardNumberLayout: TextInputLayout
    private lateinit var cardNumberEdit: TextInputEditText
    private lateinit var expMonthLayout: TextInputLayout
    private lateinit var expMonthEdit: TextInputEditText
    private lateinit var expYearLayout: TextInputLayout
    private lateinit var expYearEdit: TextInputEditText
    private lateinit var cvvLayout: TextInputLayout
    private lateinit var cvvEdit: TextInputEditText
    private lateinit var firstNameEdit: TextInputEditText
    private lateinit var lastNameEdit: TextInputEditText
    private lateinit var emailEdit: TextInputEditText
    private lateinit var payButton: Button

    private var cardClient: CardClient? = null
    private var dataCollector: DataCollector? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applyImeInsetsAsPadding()
        setContentView(R.layout.activity_vaultcheckout_card)

        diagnostics.bind(findViewById<TextView>(R.id.logText))

        amountEdit = findViewById(R.id.amountEdit)
        cardNumberLayout = findViewById(R.id.cardNumberLayout)
        cardNumberEdit = findViewById(R.id.cardNumberEdit)
        expMonthLayout = findViewById(R.id.expMonthLayout)
        expMonthEdit = findViewById(R.id.expMonthEdit)
        expYearLayout = findViewById(R.id.expYearLayout)
        expYearEdit = findViewById(R.id.expYearEdit)
        cvvLayout = findViewById(R.id.cvvLayout)
        cvvEdit = findViewById(R.id.cvvEdit)
        firstNameEdit = findViewById(R.id.firstNameEdit)
        lastNameEdit = findViewById(R.id.lastNameEdit)
        emailEdit = findViewById(R.id.emailEdit)
        payButton = findViewById(R.id.payButton)

        payButton.setOnClickListener { hideKeyboard(); tokenizeCardAndPaySaving() }
        listOf(cardNumberEdit, expMonthEdit, expYearEdit, cvvEdit).forEach {
            it.doAfterTextChanged { refreshValidation() }
        }

        loadClientTokenAndInitClients()
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

            cardClient = CardClient(this@CardVaultActivity, token)
            dataCollector = DataCollector(this@CardVaultActivity, token)

            payButton.isEnabled = true
        }
    }

    private fun tokenizeCardAndPaySaving() {
        val client = cardClient ?: run {
            diagnostics.warn("Still initializing (no client token yet).")
            return
        }

        val cardNumber = cardNumberEdit.text?.toString().orEmpty()
        val expMonth = expMonthEdit.text?.toString().orEmpty()
        val expYear = expYearEdit.text?.toString().orEmpty()
        val cvv = cvvEdit.text?.toString().orEmpty()

        if (!CardValidation.allValid(cardNumber, expMonth, expYear, cvv)) {
            diagnostics.error("Fix card fields before paying.")
            return
        }

        val card = Card(
            number = cardNumber,
            expirationMonth = expMonth,
            expirationYear = expYear,
            cvv = cvv
        )

        diagnostics.info("Tokenizing card…")
        client.tokenize(card) { result ->
            when (result) {
                is CardResult.Success -> {
                    val nonce = result.nonce.string
                    diagnostics.success("Card nonce: $nonce")
                    collectDeviceDataAndPay(nonce)
                }
                is CardResult.Failure -> diagnostics.error("Card tokenization error: ${result.error.message}")
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
        val amount = amountEdit.text?.toString().orEmpty().ifBlank { "12.34" }
        val firstName = firstNameEdit.text?.toString().orEmpty().ifBlank { null }
        val lastName = lastNameEdit.text?.toString().orEmpty().ifBlank { null }
        val email = emailEdit.text?.toString().orEmpty().ifBlank { null }

        lifecycleScope.launch {
            diagnostics.info("Sending to server: amount=$amount, storeInVaultOnSuccess=true")
            ApiClient.checkout(
                amount = amount,
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

    /** Live green/red validation on each card field, matching the original single-screen app. */
    private fun refreshValidation() {
        val cardNum = cardNumberEdit.text?.toString().orEmpty()
        val mm = expMonthEdit.text?.toString().orEmpty()
        val yy = expYearEdit.text?.toString().orEmpty()
        val cvv = cvvEdit.text?.toString().orEmpty()

        val cardValid = if (cardNum.isBlank()) null else CardValidation.isValidLuhn(cardNum)
        cardNumberLayout.setValidationState(this, cardValid, "Invalid card number")

        val monthValid = if (mm.isBlank()) null else CardValidation.isValidMonth(mm)
        expMonthLayout.setValidationState(this, monthValid, "Invalid month")

        val yearValid = if (yy.isBlank()) null else CardValidation.isValidYear(yy)
        expYearLayout.setValidationState(this, yearValid, "Invalid year")

        val expValid = if (mm.isBlank() || yy.isBlank()) null else CardValidation.isNotExpired(mm, yy)
        if (expValid == false) expYearLayout.setValidationState(this, false, "Card expired")

        val cvvValid = if (cvv.isBlank()) null else CardValidation.isValidCvv(cvv)
        cvvLayout.setValidationState(this, cvvValid, "Invalid CVV")
    }
}
