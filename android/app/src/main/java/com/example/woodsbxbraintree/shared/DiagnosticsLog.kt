package com.example.woodsbxbraintree.shared

import android.util.Log
import android.widget.TextView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Reusable diagnostics log panel.
 *
 * Every screen in the suite owns its own instance bound to its own log
 * TextView (usually inside a ScrollView so long sessions stay scrollable) —
 * logs are per-screen, not shared app-wide.
 *
 * IMPORTANT: every message is now ALSO written to Logcat (tag "BTDemo"),
 * not just the in-app TextView. Originally these only updated the UI, which
 * meant a Logcat capture during a real device test (e.g. debugging the
 * Venmo return-to-app issue) showed nothing about our own app's flow — only
 * generic Android lifecycle/window noise. Filter Logcat by tag "BTDemo" to
 * see exactly what this suite's own code was doing at each step, correlated
 * with system-level events.
 *
 * Usage from an Activity:
 *
 *   private val diagnostics = DiagnosticsLog()
 *
 *   override fun onCreate(savedInstanceState: Bundle?) {
 *       super.onCreate(savedInstanceState)
 *       setContentView(R.layout.activity_card)
 *       diagnostics.bind(findViewById(R.id.logText))
 *       diagnostics.info("Fetching client token…")
 *   }
 */
class DiagnosticsLog {

    private var textView: TextView? = null
    private val buffer = StringBuilder()
    private val timeFormat = SimpleDateFormat("HH:mm:ss", Locale.US)

    companion object {
        private const val LOGCAT_TAG = "BTDemo"
    }

    /** Attach this log to a TextView. Call once from onCreate() after setContentView(). */
    fun bind(target: TextView) {
        textView = target
        target.text = buffer.toString().ifEmpty { "Ready." }
    }

    fun info(message: String) {
        Log.i(LOGCAT_TAG, message)
        append("ℹ️", message)
    }

    fun success(message: String) {
        Log.i(LOGCAT_TAG, "SUCCESS: $message")
        append("✅", message)
    }

    fun warn(message: String) {
        Log.w(LOGCAT_TAG, message)
        append("⚠️", message)
    }

    fun error(message: String) {
        Log.e(LOGCAT_TAG, message)
        append("❌", message)
    }

    /** Raw append with no icon — for echoing exact server responses, JSON bodies, etc. */
    fun raw(message: String) {
        Log.i(LOGCAT_TAG, message)
        append(null, message)
    }

    private fun append(icon: String?, message: String) {
        val stamp = timeFormat.format(Date())
        val line = if (icon != null) "[$stamp] $icon $message" else "[$stamp] $message"
        if (buffer.isNotEmpty()) buffer.append('\n')
        buffer.append(line)
        textView?.text = buffer.toString()
    }

    fun clear() {
        buffer.clear()
        textView?.text = "Ready."
    }
}
