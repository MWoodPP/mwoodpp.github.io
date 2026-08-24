plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.example.woodsbxbraintree"
    compileSdk = 36

    defaultConfig {
        // Demo application id. Also used by the deep-link scheme:
        //   ${applicationId}.braintree
        applicationId = "com.example.woodsbxbraintree"
        minSdk = 24
        targetSdk = 36
        versionCode = 3
        versionName = "3.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_11)
    }
}


dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.constraintlayout)
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)

    // Braintree Android SDK v5 modules.
    // We only include the features we demo (card, PayPal, Venmo, fraud data collection).
    // Bumped from 5.21.0 -> 5.24.0+ specifically because `enablePayPalAppSwitch` and
    // `PayPalPaymentUserAction` (required for App Switch — see App Switch guide) were
    // added as a BETA feature at a specific SDK version point. If this still doesn't
    // resolve, check the current latest release at
    // https://github.com/braintree/braintree_android/releases and bump further.
    val braintreeVersion = "5.24.0"
    implementation("com.braintreepayments.api:card:$braintreeVersion")
    implementation("com.braintreepayments.api:paypal:$braintreeVersion")
    implementation("com.braintreepayments.api:venmo:$braintreeVersion")
    implementation("com.braintreepayments.api:google-pay:$braintreeVersion")
    implementation("com.braintreepayments.api:data-collector:$braintreeVersion")

    // Google Pay button + PaymentsClient/IsReadyToPayRequest/PaymentDataRequest types.
    // GooglePayActivity is lower-confidence than the rest of the suite — if this
    // resolves to a different API surface than assumed, treat it the same way we
    // fixed the PayPal USER_ACTION_COMMIT enum: check the actual class via
    // Cmd+B / go-to-definition rather than trusting doc prose.
    implementation("com.google.android.gms:play-services-wallet:19.4.0")

    // Networking + coroutines for calling our demo Node server.
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.0")
}
