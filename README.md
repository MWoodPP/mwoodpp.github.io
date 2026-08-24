# Braintree Android Demo

An Android reference app covering One Time Payment, Checkout with Vault, and
Vault flows across Card, PayPal, Venmo, and Google Pay — backed by a small
local Node server.

## Layout

```
android/   — the Android Studio project (app + Gradle)
server/    — the Node/Express server the app talks to
```

## Running it

### 1. Start the server

```bash
cd server
npm install
cp .env.example .env
```

Fill in `.env` with your own **sandbox** Braintree credentials (Control
Panel → API → Sandbox). `.env` is gitignored — never commit real
credentials.

```bash
npm start
```

### 2. Connect the Android device to the server

The app talks to `http://localhost:3000` from the device's own point of
view — `adb reverse` maps that back to your dev machine, which is why this
only works with a device/emulator on the same machine (or connected via USB)
as the running server, not over general wifi.

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

### 3. Open `android/` in Android Studio and run the app

`local.properties` (your SDK path) is gitignored and machine-specific —
Android Studio regenerates it automatically on first open, you don't need
to create it yourself.

## A note on `gradle.properties`

The committed version only contains portable, project-wide settings
(`android.useAndroidX`, `android.enableJetifier`). If your machine needs
corporate proxy / trust-store settings to reach Maven repos, those belong
in your **global** `~/.gradle/gradle.properties` (outside any repo, never
shared) — not in the project file, since a personal machine path there
won't work for anyone else who clones this.

## Credential safety

Same rule as any Braintree demo: the client token the app fetches from the
server is safe by design (it can tokenize a payment method but can't move
money on its own). The **private key** in `server/.env` is the one that
matters — never commit it, never paste it somewhere shared.
