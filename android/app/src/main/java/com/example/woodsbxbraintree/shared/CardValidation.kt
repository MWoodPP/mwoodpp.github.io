package com.example.woodsbxbraintree.shared

import java.util.Calendar

/**
 * Shared card-field validation, extracted from the original single-screen
 * MainActivity so every card-entry screen (One Time > Card, Checkout with
 * Vault > Card + Vault, Vault > Store: Card) behaves identically.
 */
object CardValidation {

    fun digitsOnly(s: String) = s.filter { it.isDigit() }

    /** Luhn checksum for card numbers (basic sanity check). */
    fun isValidLuhn(number: String): Boolean {
        val s = digitsOnly(number)
        if (s.length !in 12..19) return false
        var sum = 0
        var alt = false
        for (i in s.length - 1 downTo 0) {
            var n = s[i].digitToInt()
            if (alt) {
                n *= 2
                if (n > 9) n -= 9
            }
            sum += n
            alt = !alt
        }
        return sum % 10 == 0
    }

    fun isValidMonth(mm: String): Boolean {
        val m = mm.toIntOrNull() ?: return false
        return m in 1..12
    }

    fun isValidYear(yy: String): Boolean {
        val y = yy.toIntOrNull() ?: return false
        return y in 0..99
    }

    /** Expiration check against the current month/year. */
    fun isNotExpired(mm: String, yy: String): Boolean {
        val m = mm.toIntOrNull() ?: return false
        val y = yy.toIntOrNull() ?: return false
        if (!isValidMonth(mm) || !isValidYear(yy)) return false

        val now = Calendar.getInstance()
        val curY = now.get(Calendar.YEAR) % 100
        val curM = now.get(Calendar.MONTH) + 1

        return (y > curY) || (y == curY && m >= curM)
    }

    fun isValidCvv(cvv: String): Boolean {
        val s = digitsOnly(cvv)
        return s.length in 3..4
    }

    /** True only if every field is present and passes its own check. */
    fun allValid(cardNumber: String, mm: String, yy: String, cvv: String): Boolean =
        isValidLuhn(cardNumber) && isValidMonth(mm) && isValidYear(yy) &&
            isNotExpired(mm, yy) && isValidCvv(cvv)
}
