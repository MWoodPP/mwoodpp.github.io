# WoodSBXBraintree 3 — Android Braintree Demo Suite

A demo-only Android app mirroring the web Braintree demo suite's three groups:

1. **One Time Payment** — Card, PayPal, Venmo, Google Pay
2. **Checkout with Vault** — Card + Vault, PayPal + Vault
3. **Vault** — Store: Card, Store: PayPal, Store: Venmo, Store: Google Pay, Charge Vaulted

Sandbox only. Not production-ready — see [Security Notes](#security-notes-demo-only).

---

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Server Setup](#server-setup)
- [Android Project Setup](#android-project-setup)
- [Getting the Real PayPal Sandbox App](#getting-the-real-paypal-sandbox-app)
- [Getting Venmo Set Up for Testing](#getting-venmo-set-up-for-testing)
- [Test Credentials](#test-credentials)
- [Screen-by-Screen Guide](#screen-by-screen-guide)
- [Known Limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [Project Structure](#project-structure)
- [server.js Endpoint Reference](#serverjs-endpoint-reference)

---

## Architecture

```
Android App
    |
    |-- GET  /client_token
    |-- POST /checkout                (extended: optional storeInVaultOnSuccess)
    |-- POST /api/vault/store         (vault only, no charge)
    |-- GET  /api/vault/customers     (list vaulted customers + payment methods)
    |-- POST /api/vault/charge        (charge a previously vaulted token)
    |
Node.js Server (Express)
    |
    |-- Braintree Gateway (Sandbox)
```

- The Android app never talks to Braintree directly — all sensitive credentials live server-side.
- The app only ever handles short-lived client tokens and single-use nonces.
- Every screen has its own bottom log panel (also mirrored to Logcat under tag `BTDemo`) showing the full flow step by step.

---

## Prerequisites

### Software
- Android Studio (recent version)
- Node.js 18+
- A **physical Android device** — PayPal/Venmo App Switch cannot be tested on an emulator, since it depends on the real PayPal/Venmo apps being installed
- USB cable, with USB debugging enabled on the device (Settings → Developer Options → USB Debugging)

### Accounts
- Braintree **Sandbox** account, with PayPal and Venmo enabled in the sandbox Control Panel
- A personal Venmo account you can log into on the test device (see [Getting Venmo Set Up](#getting-venmo-set-up-for-testing))

---

## Server Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Create `.env`
```
BT_MERCHANT_ID=your_sandbox_merchant_id
BT_PUBLIC_KEY=your_sandbox_public_key
BT_PRIVATE_KEY=your_sandbox_private_key
BT_ENVIRONMENT=Sandbox
PORT=3000
```

### 3. Start the server
```bash
npm start
```

### 4. Verify
```
http://localhost:3000/client_token
```
Should return JSON with a `value` field.

---

## Android Project Setup

### 1. Connect the device and forward the port

**Mac:**
```bash
~/Library/Android/sdk/platform-tools/adb devices
~/Library/Android/sdk/platform-tools/adb reverse tcp:3000 tcp:3000
```

**Windows (PowerShell):**
```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" reverse tcp:3000 tcp:3000
```

This must be re-run every time the device is reconnected. Optional one-time convenience: add `platform-tools` to your shell's `PATH` so you can just type `adb` directly —
```bash
echo 'export PATH="$PATH:$HOME/Library/Android/sdk/platform-tools"' >> ~/.zshrc
source ~/.zshrc
```

### 2. Open in Android Studio and run

Open the project folder, select the physical device, and hit Run.

> **"Invalid Gradle JDK configuration found"** — click **Use Embedded JDK** in the sync banner (or Settings → Build, Execution, Deployment → Build Tools → Gradle → set Gradle JDK to Embedded JDK). This is a per-machine IDE setting, not something in the project files.

### 3. App Links (already configured — nothing to do here)

PayPal and Venmo App Switch return-to-app deep links depend on a **verified Android App Link** — this project already ships pre-configured against `mwoodpp.github.io`, with `assetlinks.json` already verified for this app's signing certificate. Each PayPal/Venmo-capable screen has its own dedicated return path under that domain (see `shared/ReturnUrls.kt`) so returns route to the correct screen automatically. You don't need to touch any of this unless you fork the project under a different `applicationId`/signing key, in which case you'd need your own verified domain and `assetlinks.json`.

---

## Getting the Real PayPal Sandbox App

App Switch requires the dedicated **PayPal Sandbox app** — not the regular consumer PayPal app, and the two conflict on the same device.

1. **Delete the regular PayPal app first** if it's installed.
2. Get the PayPal Sandbox app via Firebase App Distribution — https://paypal.atlassian.net/wiki/spaces/Checkout/pages/2586476940/External+Distribution+iOS+Firebase+Android+Firebase
3. Install it, then inside the app: **Avatar → Login and security** and enable both:
   - Face ID / fingerprint
   - "Extend your login session"

   Without these, PayPal's own eligibility check may decline to App Switch at all.

---

## Getting Venmo Set Up for Testing

This one has a real gotcha, confirmed directly by Braintree's SDK team: **the native Android/iOS SDK hardcodes a check for the exact installed package `com.venmo`**, and will never attempt App Switch against anything else. There is no separate "sandbox Venmo" package that will ever trigger it — this is by design, not a bug.

Two ways to get a working setup:

### Option A — Real Venmo app + real personal account
Simplest path: install the real, production Venmo app from the Play Store and log into a real personal account. That's genuinely sufficient — Braintree's own docs confirm a successful sandbox App Switch will still complete and return a nonce for a fixed test identity (**VenmoJoe** / `venmojoe`), regardless of which real account is logged in, and it'll show up correctly on the Braintree dashboard.

### Option B — Sandbox Venmo build via Firebase
If you get a sandbox-flavored Venmo build via Firebase App Distribution (`#vservice-pw-venmo`), be aware:
- It installs under the same package name (`com.venmo`) as production, which is why it can pass the SDK's check.
- It ships with its own **Dev Settings** screen. **Check "Choose channel"** — if it's set to *"desktop channel"*, App Switch will trigger and the payment will appear to complete, but the return-to-app deep link will never be sent, and nothing will show on the dashboard. Switch it to the mobile/native option instead.

---

## Test Credentials

- **Card:** any Braintree test number, e.g. `4111 1111 1111 1111`, any future expiry, any 3-digit CVV.
- **Venmo (sandbox):** a successful App Switch always returns a nonce for test user `venmojoe`, regardless of the real account used to authorize it. If you need a raw test nonce without going through App Switch at all, Braintree also supports `fake-venmo-account-nonce` server-side.
- **PayPal:** no special test account needed beyond a normal PayPal Sandbox login inside the Sandbox app (see above).

---

## Screen-by-Screen Guide

### One Time Payment
| Screen | App Switch? | Notes |
|---|---|---|
| Card | n/a | Live green/red field validation (Luhn, expiry, CVV) |
| PayPal | ✅ | `enablePayPalAppSwitch=true`, `userAction=USER_ACTION_COMMIT` |
| Venmo | ✅ | Requires real `com.venmo` + real/sandbox account per above |
| Google Pay | n/a (Activity Result, not deep link) | |

### Checkout with Vault
| Screen | App Switch? | Notes |
|---|---|---|
| Card + Vault | n/a | `storeInVaultOnSuccess=true` on `/checkout` |
| PayPal + Vault | ❌ browser only, by design | See [Known Limitations](#known-limitations) |

### Vault
| Screen | App Switch? | Notes |
|---|---|---|
| Store: Card | n/a | Vault only, zero dollars move |
| Store: PayPal | ✅ | `PayPalVaultRequest`, `USER_ACTION_SETUP_NOW` |
| Store: Venmo | ✅ | `VenmoPaymentMethodUsage.MULTI_USE` (required for vaulting) |
| Store: Google Pay | n/a | Nominal placeholder amount, never charged |
| Charge Vaulted | n/a | No SDK client at all — search by customer ID, defaults to 3 most recent |

---

## Known Limitations

### PayPal Checkout with Vault never App Switches — confirmed, by design
Braintree's own App Switch guide states explicitly: *"App Switch is not supported for One-time 'Continue' flow or Vaulting with Purchase flow."* Checkout with Vault (charge + save in one approval) is exactly that excluded case — it will always fall back to browser, regardless of any SDK flag. This is real, actively-tracked work internally (Jira `XOPPBU-5335`, scope explicitly includes BT Native SDK iOS/Android), but as of this writing it's still pre-development ("Defined" status) with no committed ship date — targets that existed (Q1/Q2 2026) have already passed.

### Google Pay — verified working, but a newer SDK release could shift the API again
Both Google Pay screens were originally written from the same architectural pattern as Card/PayPal/Venmo, which turned out right about the overall shape but wrong on several specifics (constructor params, enum names, activity params). All known issues are now fixed and confirmed working end-to-end — but if a future `com.braintreepayments.api:google-pay` version changes the API surface again, Cmd+B / go-to-definition on the classes in `GooglePayActivity.kt` is the fastest way to re-diagnose, the same way today's fixes were found.

---

## Troubleshooting

**Keyboard covers the diagnostics log after tapping Pay/Store** — already handled: every action button calls a shared `hideKeyboard()` before starting its flow.

**App crashes immediately with `ClassNotFoundException`** — almost always a stale APK from a prior failed build. Uninstall the app from the device, Clean Project, Rebuild Project, then Run again (not "Apply Changes").

**PayPal/Venmo opens a browser instead of App Switching**
- For PayPal one-time and Vault > Store: PayPal — check the real PayPal Sandbox app is installed (not the regular app) and biometrics/session extension are enabled in it.
- For PayPal Checkout with Vault — this is [expected](#known-limitations), not a bug.
- For Venmo — confirm you're on the real `com.venmo` package (`adb shell pm list packages | grep -i venmo`) with a real account, or check the sandbox build's Dev Settings channel per [above](#getting-venmo-set-up-for-testing).

**Client token not loading** — confirm the server is running and re-run `adb reverse tcp:3000 tcp:3000`.

---

## Project Structure

```
app/src/main/java/com/example/woodsbxbraintree/
  PickerActivity.kt              launcher, routes to all 3 groups
  onetime/                       Card, PayPal, Venmo, Google Pay
  checkoutwithvault/             Card + Vault, PayPal + Vault
  vault/                         Store: Card/PayPal/Venmo/Google Pay, Charge Vaulted
  shared/
    ApiClient.kt                 all server.js calls
    DiagnosticsLog.kt            per-screen log panel (also -> Logcat tag "BTDemo")
    ReturnUrls.kt                per-screen App Link paths + fallback schemes
    CardValidation.kt            Luhn/expiry/CVV checks
    ValidationUi.kt              shared green/red TextInputLayout coloring
    WindowInsetsCompatHelper.kt  keyboard/nav-bar inset handling + hideKeyboard()
```

Each PayPal/Venmo-capable screen owns its **own** App Link path and fallback scheme (see `ReturnUrls.kt`) so return-to-app deep links route to the correct screen without any shared "which flow was pending" state.

---

## server.js Endpoint Reference

| Endpoint | Used by |
|---|---|
| `GET /client_token` | every screen |
| `POST /checkout` | One Time Payment screens; Checkout with Vault screens (with `storeInVaultOnSuccess`) |
| `POST /api/vault/store` | Vault > Store: Card/PayPal/Venmo/Google Pay |
| `GET /api/vault/customers` | Vault > Charge Vaulted |
| `POST /api/vault/charge` | Vault > Charge Vaulted |

---

## Security Notes (Demo Only)

This demo intentionally:
- Uses HTTP (`usesCleartextTraffic="true"`)
- Logs full request/response detail to screen and Logcat
- Stores pending app-switch state in plain `SharedPreferences`

**Do not use this configuration in production.** Production apps must use HTTPS, remove verbose logging, harden error handling, and use production Braintree credentials.
