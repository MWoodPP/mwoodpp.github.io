//IN POWERSHELL ALWAYS ON SAME NETWORK
//First
//dir "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"

//Second
//& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices

//Third
//& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" reverse tcp:3000 tcp:3000

// OR THIS IF MAC 
//First > Verifies Device is visible > 
// ~/Library/Android/sdk/platform-tools/adb devices

//Second > Opens port 3000 to be visible on the device > 
// ~/Library/Android/sdk/platform-tools/adb reverse tcp:3000 tcp:3000

//NPM ISSUES: https://paypal.atlassian.net/wiki/spaces/PCT/pages/1100590929/NPM+Config


require("dotenv").config();

const express = require("express");
const braintree = require("braintree");

const app = express();
app.use(express.json());
for (const k of ["BT_MERCHANT_ID", "BT_PUBLIC_KEY", "BT_PRIVATE_KEY"]) {
  if (!process.env[k]) {
    console.error(`Missing required env var: ${k}`);
    process.exit(1);
  }
}

// ------------------------------
// Braintree Gateway
// ------------------------------
const gateway = new braintree.BraintreeGateway({
  environment:
    (process.env.BT_ENVIRONMENT || 'Sandbox').toLowerCase() === 'production'
      ? braintree.Environment.Production
      : braintree.Environment.Sandbox,
  merchantId: process.env.BT_MERCHANT_ID,
  publicKey: process.env.BT_PUBLIC_KEY,
  privateKey: process.env.BT_PRIVATE_KEY
});

// Return a client token in the shape Braintree's docs demonstrate ({ value: "..." })
app.get("/client_token", async (req, res) => {
  try {
    const result = await gateway.clientToken.generate({});
    res.json({ value: result.clientToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
// POST /checkout
//
// EXTENDED for the Android suite's "Checkout with Vault" screens.
// One Time Payment screens call this exactly as before (no new fields).
// Checkout with Vault screens additionally send:
//   storeInVaultOnSuccess: true
//   customerId              (if charging/vaulting under an EXISTING customer)
//   customer: { firstName, lastName, email }   (if creating a NEW customer)
// ------------------------------------------------------------------
app.post("/checkout", async (req, res) => {
  try {
    const {
      amount,
      paymentMethodNonce,
      deviceData,
      storeInVaultOnSuccess,
      customerId,
      customer,
    } = req.body;

    const txRequest = {
      amount,
      paymentMethodNonce,
      deviceData, // IMPORTANT: required for Venmo transactions; good practice generally
      options: {
        submitForSettlement: true, // sandbox demo
        ...(storeInVaultOnSuccess ? { storeInVaultOnSuccess: true } : {}),
      },
    };

    if (storeInVaultOnSuccess) {
      if (customerId) {
        txRequest.customerId = customerId;
      } else if (customer) {
        txRequest.customer = customer;
      }
    }

    const result = await gateway.transaction.sale(txRequest);
    const tx = result.transaction;

    res.json({
      success: result.success,
      transactionId: tx && tx.id,
      status: tx && tx.status,
      message: result.message,
      // Handy for the app to display / reuse — the token of whatever got
      // vaulted as a side effect of this sale, if anything did.
      vaultedPaymentMethodToken:
        (tx && tx.creditCard && tx.creditCard.token) ||
        (tx && tx.paypalAccount && tx.paypalAccount.token) ||
        null,
      vaultedCustomerId: (tx && tx.customer && tx.customer.id) || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
// POST /api/vault/store   [NEW]
//
// Vault > Store: Card / Store: PayPal screens.
// Creates a customer + vaults the payment method — NO transaction.sale
// call happens here, so zero dollars move.
// ------------------------------------------------------------------
app.post("/api/vault/store", async (req, res) => {
  try {
    const { paymentMethodNonce, customer } = req.body;

    if (!paymentMethodNonce) {
      return res.status(400).json({
        success: false,
        error: "paymentMethodNonce is required",
      });
    }

    const customerRequest = { paymentMethodNonce };
    if (customer) {
      if (customer.firstName) customerRequest.firstName = customer.firstName;
      if (customer.lastName) customerRequest.lastName = customer.lastName;
      if (customer.email) customerRequest.email = customer.email;
    }

    const result = await gateway.customer.create(customerRequest);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.message });
    }

    const c = result.customer;
    res.json({
      success: true,
      customer: {
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        paymentMethods: (c.paymentMethods || []).map((pm) => ({
          token: pm.token,
          last4: pm.last4,
          cardType: pm.cardType,
          email: pm.email,
          default: pm.default,
        })),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ------------------------------------------------------------------
// GET /api/vault/customers   [NEW]
//
// Vault > Charge Vaulted screen's picker list. Lists every customer and
// their vaulted payment methods so the app can show "charge this" buttons.
//
// NOTE: gateway.customer.search(...) returns an async-iterable stream in
// recent braintree Node SDK versions (for-await works directly on it). If
// your installed SDK version predates that, switch to the .on('data', ...)
// / .on('end', ...) stream-event style instead — check your
// `braintree` package.json version if this throws.
// ------------------------------------------------------------------
app.get("/api/vault/customers", async (req, res) => {
  try {
    const customers = [];
    const stream = gateway.customer.search((search) => {
      search.id().startsWith(""); // matches all customers
    });

    for await (const customer of stream) {
      customers.push({
        id: customer.id,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        paymentMethods: (customer.paymentMethods || []).map((pm) => ({
          token: pm.token,
          last4: pm.last4,
          cardType: pm.cardType,
          email: pm.email,
          default: pm.default,
        })),
      });
    }

    res.json({ success: true, customers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ------------------------------------------------------------------
// POST /api/vault/charge   [NEW]
//
// Vault > Charge Vaulted screen. Charges a previously vaulted
// paymentMethodToken directly — no SDK client involved on the Android side
// at all for this call.
// ------------------------------------------------------------------
app.post("/api/vault/charge", async (req, res) => {
  try {
    const { paymentMethodToken, amount } = req.body;

    if (!paymentMethodToken || !amount) {
      return res.status(400).json({
        success: false,
        error: "paymentMethodToken and amount are required",
      });
    }

    const result = await gateway.transaction.sale({
      amount,
      paymentMethodToken,
      options: { submitForSettlement: true },
    });

    res.json({
      success: result.success,
      transactionId: result.transaction && result.transaction.id,
      status: result.transaction && result.transaction.status,
      message: result.message,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Braintree demo server on :${port}`));
