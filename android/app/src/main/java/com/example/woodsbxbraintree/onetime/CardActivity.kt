package com.example.woodsbxbraintree.onetime

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
 * One Time Payment > Card.
 *
 * Flow: tokenize card -> collect device data -> POST /checkout (one-time
 * sale, no vaulting). Mirrors the card half of the original single-screen
 * MainActivity.
 */
class CardActivity : ComponentActivity() {

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
    private lateinit var payButton: Button

    private var cardClient: CardClient? = null
    private var dataCollector: DataCollector? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applyImeInsetsAsPadding()
        setContentView(R.layout.activity_onetime_card)

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
        payButton = findViewById(R.id.payButton)

        payButton.setOnClickListener { hideKeyboard(); tokenizeCardAndPay() }
        listOf(cardNumberEdit, expMonthEdit, expYearEdit, cvvEdit).forEach {
            it.doAfterTextChanged { refreshValidation() }
        }

        loadClientTokenAndInitClients()
    }

    private fun loadClientTokenAndInitClients() {
        lifecycleScope.launch {
            diagnostics.info("Fetching client token…")
            val tokenResult = ApiClient.fetchClientToken()
            val token = tokenResult.getOrNull()
            if (token == null) {
                diagnostics.error("Failed to fetch client token: ${tokenResult.exceptionOrNull()?.message}")
                return@launch
            }
            diagnostics.success("Got client token")

            cardClient = CardClient(this@CardActivity, token)
            dataCollector = DataCollector(this@CardActivity, token)

            payButton.isEnabled = true
        }
    }

    private fun tokenizeCardAndPay() {
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
                    collectDeviceDataAndCheckout(nonce)
                }
                is CardResult.Failure -> diagnostics.error("Card tokenization error: ${result.error.message}")
            }
        }
    }

    private fun collectDeviceDataAndCheckout(nonce: String) {
        val collector = dataCollector
        if (collector == null) {
            diagnostics.warn("No data collector; sending nonce only.")
            createTransaction(nonce, deviceData = null)
            return
        }

        val req = DataCollectorRequest(hasUserLocationConsent = false)
        collector.collectDeviceData(this, req) { result ->
            when (result) {
                is DataCollectorResult.Success -> {
                    diagnostics.success("deviceData collected")
                    createTransaction(nonce, deviceData = result.deviceData)
                }
                is DataCollectorResult.Failure -> {
                    diagnostics.warn("deviceData failed: ${result.error.message}")
                    createTransaction(nonce, deviceData = null)
                }
            }
        }
    }

    private fun createTransaction(nonce: String, deviceData: String?) {
        val amount = amountEdit.text?.toString().orEmpty().ifBlank { "12.34" }
        lifecycleScope.launch {
            diagnostics.info("Sending to server: amount=$amount")
            val result = ApiClient.checkout(amount = amount, paymentMethodNonce = nonce, deviceData = deviceData)
            result.onSuccess { diagnostics.raw("Server response:\n$it") }
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

        // Expiration is a combined constraint: month+year must be in the future.
        val expValid = if (mm.isBlank() || yy.isBlank()) null else CardValidation.isNotExpired(mm, yy)
        if (expValid == false) expYearLayout.setValidationState(this, false, "Card expired")

        val cvvValid = if (cvv.isBlank()) null else CardValidation.isValidCvv(cvv)
        cvvLayout.setValidationState(this, cvvValid, "Invalid CVV")
    }
}
