# Braintree Demo Suite

A local, sandbox-only reference implementation covering every major
Braintree integration pattern — one-time payments, checkout-with-vault,
pure vault storage, 3D Secure, and detached-credit payouts — across Card,
PayPal, Pay Later, Venmo, Google Pay, Apple Pay, and ACH.

Every demo page ships with a **Live Code panel** that highlights the exact
client (`app.js`) and server (`server.js`) code as each step runs, and most
pages include a reference panel of documented sandbox test values pulled
directly from Braintree's own docs.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` with your own **sandbox** credentials from the Braintree
Control Panel (API → Sandbox):

```
BT_ENVIRONMENT=Sandbox
BT_MERCHANT_ID=...
BT_PUBLIC_KEY=...
BT_PRIVATE_KEY=...
```

**`.env` is gitignored — never commit real credentials.** Each person
running this locally should use their own sandbox keys, not a shared file.

### HTTPS (required for Apple Pay / some other flows)

The server runs over self-signed HTTPS, since Apple Pay refuses to start a
session from an insecure (`http://`) document. Generate a local cert once:

```bash
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout localhost-key.pem -out localhost-cert.pem \
  -days 365 -subj "/CN=localhost"
```

Place both `.pem` files in the project root, alongside `server.js`. These
are also gitignored — they're machine-specific and regenerate in seconds.

### Run it

```bash
npm start
```

Then visit `https://localhost:3000` (Safari will warn about the
self-signed cert on first load — that's expected, just proceed).

## Running in GitHub Codespaces

This repo includes a `.devcontainer/devcontainer.json`, so you can run the
whole suite from a browser with no local setup at all.

### One-time setup — add your credentials as Codespaces secrets

Codespaces secrets get injected directly as real environment variables when
a Codespace starts — this is the Codespaces-native equivalent of `.env`,
and means a private key never has to be typed into a file at all, let alone
committed. Set these up **once**, at either the repo or your personal
GitHub account level:

**Settings → Secrets and variables → Codespaces** (repo settings, if you
want it available to anyone who opens a Codespace on this repo) — or
**your GitHub profile → Settings → Codespaces** (if you'd rather keep it
scoped to just your own Codespaces).

Add these four secrets, matching `.env.example`:
```
BT_ENVIRONMENT
BT_MERCHANT_ID
BT_PUBLIC_KEY
BT_PRIVATE_KEY
```

### Launch it

1. On this repo's GitHub page, **Code → Codespaces → Create codespace on
   `wood-braintree-super-demo`**.
2. Wait for `npm install` to finish (runs automatically via
   `postCreateCommand`).
3. Run `npm start` in the Codespace terminal.
4. A "Braintree Demo Suite" port notification should appear — click it (or
   check the **Ports** tab) to open the forwarded `https://...app.github.dev`
   URL. This URL has a real, valid TLS certificate from Codespaces itself,
   so there's no self-signed-cert browser warning to click through, unlike
   running locally.

### The one thing that doesn't fully work here: Apple Pay

Every other demo works the same in Codespaces as it does locally. Apple Pay
specifically needs its exact domain registered in Braintree's Control Panel
(see that demo's own reference panel) — a Codespace's forwarded URL is a
random subdomain that changes per Codespace, so it was never registered and
merchant validation will fail. Test Apple Pay from a fixed, registered
domain (local HTTPS, or a real deployed domain) instead.

## What's here

| Group | What it demonstrates |
|---|---|
| **One Time Payment** | A single sale, nothing stored — across all 8 payment methods, including Card + 3D Secure |
| **Checkout with Vault** | Same purchase flow, plus an option to save the payment method for next time |
| **Vault** | Store a payment method with zero dollars moving, then charge it later from a separate flow |
| **Payouts** | Detached (blind) credit — merchant-to-customer, no prior sale. Card-only; PayPal/Venmo/ACH all reject this by design (see the Payouts page's reference panel for why) |

## A few things worth knowing before you demo this

- **Apple Pay** needs its own domain registered in Braintree's Control
  Panel (Processing Options → Apple Pay → Web Domains) before the sheet
  will complete merchant validation — `localhost` alone won't pass. See the
  reference panel on that page for the full explanation.
- **Payouts (detached credit)** requires "Credits Enabled" set on the
  merchant account (an internal Braintree gateway toggle, not self-service)
  plus a role permission for "Create Credits without a Previous
  Transaction." It's confirmed working for Card only — PayPal, Venmo, and
  ACH all reject with error `91546`.
- **ACH** requires a Cosmos processor connection + network-check toggle on
  the sandbox merchant account before its test values will clear.

## Credential safety

The client token shown in every page's top bar is safe to screenshot or
share — Braintree's client tokens can tokenize a payment method but can't
move money on their own. The **private key** in `.env` is the opposite:
treat it like a password, never paste it into the "custom credentials"
checkbox on a shared screen, and never commit it.
