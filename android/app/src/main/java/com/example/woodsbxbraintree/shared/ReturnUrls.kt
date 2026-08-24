package com.example.woodsbxbraintree.shared

import android.net.Uri

/**
 * Per-flow return URLs / fallback schemes for every screen that app-switches
 * out to PayPal or Venmo.
 *
 * WHY PER-FLOW, NOT ONE SHARED PATH:
 * The original single-screen app used one path for everything
 * (https://mwoodpp.github.io/braintree/return) because there was only ever
 * one Activity to return to. Now that PayPal/Venmo checkout lives on four
 * different screens (One Time > PayPal, One Time > Venmo, Checkout with
 * Vault > PayPal + Vault, Vault > Store: PayPal), each one gets its own
 * path + scheme so Android routes the return-to-app deep link straight to
 * the correct exported Activity via its <intent-filter> in
 * AndroidManifest.xml — no shared "which flow was pending" state needed.
 *
 * All paths still live under the SAME verified domain (mwoodpp.github.io),
 * so the existing assetlinks.json / App Link verification you already did
 * for today's App Switch fix covers all of these paths — nothing new to
 * verify.
 */
object ReturnUrls {

    private const val DOMAIN = "mwoodpp.github.io"

    /** com.example.woodsbxbraintree (dynamic so it still works if applicationId ever changes). */
    private fun fallbackSchemeBase(applicationId: String) = "$applicationId.braintree"

    // -----------------------------
    // One Time Payment > PayPal
    // -----------------------------
    fun oneTimePayPalAppLink(): Uri = Uri.parse("https://$DOMAIN/braintree/onetime-paypal")
    fun oneTimePayPalFallbackScheme(applicationId: String) = "${fallbackSchemeBase(applicationId)}.onetimepaypal"

    // -----------------------------
    // One Time Payment > Venmo
    // -----------------------------
    fun oneTimeVenmoAppLink(): Uri = Uri.parse("https://$DOMAIN/braintree/onetime-venmo")
    fun oneTimeVenmoFallbackScheme(applicationId: String) = "${fallbackSchemeBase(applicationId)}.onetimevenmo"

    // -----------------------------
    // Checkout with Vault > PayPal + Vault
    // -----------------------------
    fun checkoutVaultPayPalAppLink(): Uri = Uri.parse("https://$DOMAIN/braintree/checkoutvault-paypal")
    fun checkoutVaultPayPalFallbackScheme(applicationId: String) = "${fallbackSchemeBase(applicationId)}.checkoutvaultpaypal"

    // -----------------------------
    // Vault > Store: PayPal
    // -----------------------------
    fun storePayPalAppLink(): Uri = Uri.parse("https://$DOMAIN/braintree/store-paypal")
    fun storePayPalFallbackScheme(applicationId: String) = "${fallbackSchemeBase(applicationId)}.storepaypal"

    // -----------------------------
    // Vault > Store: Venmo
    // -----------------------------
    fun storeVenmoAppLink(): Uri = Uri.parse("https://$DOMAIN/braintree/store-venmo")
    fun storeVenmoFallbackScheme(applicationId: String) = "${fallbackSchemeBase(applicationId)}.storevenmo"
}
