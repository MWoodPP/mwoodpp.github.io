package com.example.woodsbxbraintree

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import com.example.woodsbxbraintree.checkoutwithvault.CardVaultActivity
import com.example.woodsbxbraintree.checkoutwithvault.PayPalVaultActivity
import com.example.woodsbxbraintree.onetime.CardActivity
import com.example.woodsbxbraintree.onetime.GooglePayActivity
import com.example.woodsbxbraintree.onetime.PayPalActivity
import com.example.woodsbxbraintree.onetime.VenmoActivity
import com.example.woodsbxbraintree.shared.applyImeInsetsAsPadding
import com.example.woodsbxbraintree.vault.ChargeVaultedActivity
import com.example.woodsbxbraintree.vault.StoreCardActivity
import com.example.woodsbxbraintree.vault.StoreGooglePayActivity
import com.example.woodsbxbraintree.vault.StorePayPalActivity
import com.example.woodsbxbraintree.vault.StoreVenmoActivity
import com.google.android.material.button.MaterialButton

/**
 * Launcher screen — mirrors the web demo suite's 3 groups:
 *   1) One Time Payment      (onetime package)
 *   2) Checkout with Vault   (checkoutwithvault package)
 *   3) Vault                 (vault package)
 *
 * This screen does nothing Braintree-specific itself — it's pure navigation.
 */
class PickerActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applyImeInsetsAsPadding()
        setContentView(R.layout.activity_picker)

        // --- One Time Payment ---
        findViewById<MaterialButton>(R.id.btnOneTimeCard).setOnClickListener {
            startActivity(Intent(this, CardActivity::class.java))
        }
        findViewById<MaterialButton>(R.id.btnOneTimePayPal).setOnClickListener {
            startActivity(Intent(this, PayPalActivity::class.java))
        }
        findViewById<MaterialButton>(R.id.btnOneTimeVenmo).setOnClickListener {
            startActivity(Intent(this, VenmoActivity::class.java))
        }
        findViewById<MaterialButton>(R.id.btnOneTimeGooglePay).setOnClickListener {
            startActivity(Intent(this, GooglePayActivity::class.java))
        }

        // --- Checkout with Vault ---
        findViewById<MaterialButton>(R.id.btnVaultCheckoutCard).setOnClickListener {
            startActivity(Intent(this, CardVaultActivity::class.java))
        }
        findViewById<MaterialButton>(R.id.btnVaultCheckoutPayPal).setOnClickListener {
            startActivity(Intent(this, PayPalVaultActivity::class.java))
        }

        // --- Vault ---
        findViewById<MaterialButton>(R.id.btnVaultStoreCard).setOnClickListener {
            startActivity(Intent(this, StoreCardActivity::class.java))
        }
        findViewById<MaterialButton>(R.id.btnVaultStorePayPal).setOnClickListener {
            startActivity(Intent(this, StorePayPalActivity::class.java))
        }
        findViewById<MaterialButton>(R.id.btnVaultStoreVenmo).setOnClickListener {
            startActivity(Intent(this, StoreVenmoActivity::class.java))
        }
        findViewById<MaterialButton>(R.id.btnVaultStoreGooglePay).setOnClickListener {
            startActivity(Intent(this, StoreGooglePayActivity::class.java))
        }
        findViewById<MaterialButton>(R.id.btnVaultCharge).setOnClickListener {
            startActivity(Intent(this, ChargeVaultedActivity::class.java))
        }
    }
}
