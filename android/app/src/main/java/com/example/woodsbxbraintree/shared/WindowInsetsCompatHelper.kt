package com.example.woodsbxbraintree.shared

import android.app.Activity
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.updatePadding

/**
 * Makes keyboard-covering content actually resize on Android 16 (API 36).
 *
 * FIRST ATTEMPT (WindowCompat.setDecorFitsSystemWindows(window, true)) DID
 * NOT WORK — confirmed why: apps targeting API 36 can no longer opt out of
 * edge-to-edge at all. Android 15 (API 35) let you opt out via
 * `windowOptOutEdgeToEdgeEnforcement` / setDecorFitsSystemWindows(true).
 * Android 16 (API 36) — which this project compiles/targets — silently
 * ignores that opt-out entirely. So the old "legacy adjustResize" trick is
 * dead for this project; the only correct fix is to actually consume IME
 * insets ourselves.
 *
 * This listens for window insets (system bars + on-screen keyboard) and
 * applies them as bottom padding on the root content view. Combined with
 * the layouts already being wrapped in `ScrollView android:fillViewport=
 * "true"`, this lets the scrollable area shrink correctly when the
 * keyboard appears, so focused fields (like Email, near the bottom of the
 * Checkout with Vault > Card form) scroll into view above the keyboard
 * instead of being covered by it.
 *
 * Call once from onCreate(), AFTER setContentView().
 */
fun Activity.applyImeInsetsAsPadding() {
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
        val bars = insets.getInsets(
            WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime()
        )
        view.updatePadding(bottom = bars.bottom)
        insets
    }
}

/**
 * Dismisses the on-screen keyboard, if shown. Call this at the start of any
 * submit/pay/store button handler — otherwise, on return from an app-switch
 * flow (PayPal/Venmo) the keyboard can still be up, covering the diagnostics
 * log panel and requiring a manual dismiss to see the result.
 */
fun Activity.hideKeyboard() {
    val view = currentFocus ?: window.decorView
    WindowInsetsControllerCompat(window, view).hide(WindowInsetsCompat.Type.ime())
    view.clearFocus()
}
