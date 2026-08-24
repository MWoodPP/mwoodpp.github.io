package com.example.woodsbxbraintree.shared

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/**
 * Thin, reusable wrapper around our demo Node server (server.js).
 *
 * Server must be reachable at http://localhost:3000 — for a physical device
 * over USB:
 *   adb reverse tcp:3000 tcp:3000
 *
 * Endpoints used:
 *   GET  /client_token          -> { value: "<token>" }                          [existing, unchanged]
 *   POST /checkout               -> one-time sale; optional vault-on-success      [existing, EXTENDED — see server.js diff]
 *   POST /api/vault/store        -> create customer + vault payment method, $0     [NEW — required by server.js diff]
 *   GET  /api/vault/customers    -> list vaulted customers + payment methods       [NEW — required by server.js diff]
 *   POST /api/vault/charge       -> charge a previously vaulted payment method     [NEW — required by server.js diff]
 *
 * The three "NEW" endpoints do not exist in the server.js you're currently
 * running — they're required for the Checkout with Vault and Vault screens
 * to function. See the server.js diff delivered alongside this project.
 */
object ApiClient {

    /**
     * Physical device over USB:
     * - run: adb reverse tcp:3000 tcp:3000
     * - then the phone can reach the dev machine's server at http://localhost:3000
     */
    const val BASE_URL = "http://localhost:3000"

    private val http = OkHttpClient()
    private val jsonMediaType = "application/json".toMediaType()

    // -----------------------------
    // GET /client_token
    // -----------------------------
    suspend fun fetchClientToken(): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val req = Request.Builder().url("$BASE_URL/client_token").get().build()
            http.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) error("HTTP ${resp.code}")
                val body = resp.body?.string() ?: error("Empty response body")
                JSONObject(body).getString("value")
            }
        }
    }

    // -----------------------------
    // POST /checkout
    // One Time Payment screens call this with storeInVaultOnSuccess = false (default).
    // Checkout with Vault screens call this with storeInVaultOnSuccess = true and
    // either an existing customerId, or first/last/email to create a new customer
    // as part of the same sale.
    // -----------------------------
    suspend fun checkout(
        amount: String,
        paymentMethodNonce: String,
        deviceData: String? = null,
        storeInVaultOnSuccess: Boolean = false,
        customerId: String? = null,
        customerFirstName: String? = null,
        customerLastName: String? = null,
        customerEmail: String? = null
    ): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val json = JSONObject().apply {
                put("amount", amount)
                put("paymentMethodNonce", paymentMethodNonce)
                deviceData?.let { put("deviceData", it) }
                if (storeInVaultOnSuccess) {
                    put("storeInVaultOnSuccess", true)
                    when {
                        customerId != null -> put("customerId", customerId)
                        customerFirstName != null || customerLastName != null || customerEmail != null -> {
                            put("customer", JSONObject().apply {
                                customerFirstName?.let { put("firstName", it) }
                                customerLastName?.let { put("lastName", it) }
                                customerEmail?.let { put("email", it) }
                            })
                        }
                    }
                }
            }.toString()

            postJson("$BASE_URL/checkout", json)
        }
    }

    // -----------------------------
    // POST /api/vault/store  (Vault > Store: vault-only, zero dollars move)
    // -----------------------------
    suspend fun vaultStore(
        paymentMethodNonce: String,
        customerFirstName: String? = null,
        customerLastName: String? = null,
        customerEmail: String? = null
    ): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val json = JSONObject().apply {
                put("paymentMethodNonce", paymentMethodNonce)
                if (customerFirstName != null || customerLastName != null || customerEmail != null) {
                    put("customer", JSONObject().apply {
                        customerFirstName?.let { put("firstName", it) }
                        customerLastName?.let { put("lastName", it) }
                        customerEmail?.let { put("email", it) }
                    })
                }
            }.toString()

            postJson("$BASE_URL/api/vault/store", json)
        }
    }

    // -----------------------------
    // GET /api/vault/customers  (Vault > Charge Vaulted: picker list)
    // -----------------------------
    suspend fun vaultCustomers(): Result<JSONArray> = withContext(Dispatchers.IO) {
        runCatching {
            val req = Request.Builder().url("$BASE_URL/api/vault/customers").get().build()
            http.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) error("HTTP ${resp.code}")
                val body = resp.body?.string() ?: error("Empty response body")
                JSONObject(body).getJSONArray("customers")
            }
        }
    }

    // -----------------------------
    // POST /api/vault/charge  (Vault > Charge Vaulted: no SDK, no card entry)
    // -----------------------------
    suspend fun vaultCharge(
        paymentMethodToken: String,
        amount: String
    ): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val json = JSONObject().apply {
                put("paymentMethodToken", paymentMethodToken)
                put("amount", amount)
            }.toString()

            postJson("$BASE_URL/api/vault/charge", json)
        }
    }

    private fun postJson(url: String, json: String): String {
        val body = json.toRequestBody(jsonMediaType)
        val req = Request.Builder().url(url).post(body).build()
        return http.newCall(req).execute().use { resp ->
            resp.body?.string() ?: "(empty)"
        }
    }
}
