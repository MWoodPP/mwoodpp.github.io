package com.example.woodsbxbraintree.shared

import android.content.Context
import android.content.res.ColorStateList
import androidx.core.content.ContextCompat
import com.google.android.material.textfield.TextInputLayout

/**
 * Sets a TextInputLayout's box stroke to green/red/neutral based on a
 * three-state validity check, matching the original single-screen app's
 * live card validation. Extracted here so it's shared across every
 * card-entry screen (One Time > Card, Checkout with Vault > Card + Vault,
 * Vault > Store: Card) instead of copy-pasted three times.
 */
fun TextInputLayout.setValidationState(context: Context, valid: Boolean?, errorMsg: String? = null) {
    val okColor = ContextCompat.getColor(context, android.R.color.holo_green_dark)
    val badColor = ContextCompat.getColor(context, android.R.color.holo_red_dark)
    val neutralColor = ContextCompat.getColor(context, android.R.color.darker_gray)

    val color = when (valid) {
        true -> okColor
        false -> badColor
        null -> neutralColor
    }
    boxStrokeColor = color
    setErrorTextColor(ColorStateList.valueOf(badColor))
    error = if (valid == false) errorMsg else null
}
