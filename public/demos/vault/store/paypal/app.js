/**
 * ============================================================================
 * VAULT — Store PayPal (No Purchase)
 * ============================================================================
 * THE ONE LINE THAT MAKES THIS GENUINELY DIFFERENT FROM EVERY OTHER PAYPAL
 * DEMO IN THIS SUITE:
 * ---------------------------------------------------------------------------
 *     paypalCheckoutInstance.createPayment({ flow: 'vault', ... })
 *
 * Every other PayPal integration in this suite (One Time Payment → PayPal,
 * Checkout with Vault → PayPal, Pay Later) uses `flow: 'checkout'` — the
 * buyer is approving a specific purchase, with or without also agreeing to
 * save the account. `flow: 'vault'` is different: there's no amount, no
 * purchase, nothing to approve except the billing agreement itself. The
 * buyer sees PayPal's consent screen for "allow this merchant to charge you
 * in the future," full stop.
 *
 * This is the direct counterpart to the Card version of this page — same
 * end result (a Customer + vaulted payment method, no money moved), just
 * reached via PayPal's login/approval flow instead of a card form.
 *
 * ONE MORE GOTCHA WORTH KNOWING: because this flow loads the PayPal JS SDK
 * with intent=tokenize (not intent=capture, which every other PayPal demo
 * in this suite uses), the Buttons() callback must be named
 * `createBillingAgreement` instead of `createOrder`. Using the wrong name
 * throws "Must pass createBillingAgreement with intent=tokenize" — an easy
 * mistake since every other PayPal integration example uses createOrder.
 * ============================================================================
 */

Diagnostics.init('#diagnostics-panel');

let paypalCheckoutInstance = null;

function getCredentialOverrides() {
  const editing = document.getElementById('cfg-edit-toggle')?.checked;
  if (!editing) return {};
  return {
    environment: document.getElementById('cfg-environment')?.value,
    merchantId: document.getElementById('cfg-merchant-id')?.value,
    publicKey: document.getElementById('cfg-public-key')?.value,
    privateKey: document.getElementById('cfg-private-key')?.value,
  };
}

function getCustomerDetails() {
  return {
    firstName: document.getElementById('cust-first-name')?.value || '',
    lastName: document.getElementById('cust-last-name')?.value || '',
    email: document.getElementById('cust-email')?.value || '',
  };
}

function renderPayPalButton() {
  const container = document.getElementById('paypal-button-container');
  container.innerHTML = '';

  window.paypal.Buttons({
    fundingSource: window.paypal.FUNDING.PAYPAL,

    // NOTE: because the SDK loads with intent=tokenize (vault-only), the
    // Buttons component requires this callback to be named
    // createBillingAgreement instead of createOrder — that naming is
    // specific to intent=tokenize; every other demo in this suite uses
    // intent=capture and createOrder instead.
    // >>> STEP:createbillingagreement
    createBillingAgreement: async function () {
      Diagnostics.log('pending', 'Creating vault-only billing agreement (no amount, no purchase)...');
      await CodePanel.goToClientStep('createbillingagreement');

      // flow: 'vault' is the whole point of this page — see file header.
      return paypalCheckoutInstance.createPayment({
        flow: 'vault',
        billingAgreementDescription: 'Braintree Demo Suite — save PayPal for future use',
      }).then((paymentId) => {
        Diagnostics.log('success', 'Billing agreement setup created', { paymentId });
        return paymentId;
      }).catch((err) => {
        Diagnostics.log('error', 'createPayment() failed', { message: err.message });
        throw err;
      });
    },
    // <<< STEP:createbillingagreement

    // >>> STEP:tokenize
    onApprove: async function (data) {
      Diagnostics.log('pending', 'Buyer approved billing agreement — tokenizing...');
      // NOTE: no pause here — see one-time/paypal/app.js's onApprove for
      // why (PayPal's popup is already waiting on this callback).

      return paypalCheckoutInstance.tokenizePayment(data).then(async (payload) => {
        Diagnostics.log('success', 'Nonce created', payload);
        await CodePanel.goToClientStep('tokenize');
        return submitVaultStore(payload.nonce);
      }).catch((err) => {
        Diagnostics.log('error', 'tokenizePayment() failed', { message: err.message });
      });
    },
    // <<< STEP:tokenize

    onCancel: function (data) {
      Diagnostics.log('info', 'Buyer closed the PayPal window before completing', data);
      const resultBanner = document.getElementById('result-banner');
      resultBanner.textContent = 'Cancelled by buyer.';
      resultBanner.className = 'result-banner show error';
    },

    onError: function (err) {
      Diagnostics.log('error', 'PayPal Buttons error', { message: err.message || String(err) });
    },

  }).render('#paypal-button-container').then(() => {
    Diagnostics.log('success', 'PayPal button rendered');
  });
}

async function submitVaultStore(nonce) {
  const customer = getCustomerDetails();
  const resultBanner = document.getElementById('result-banner');
  const vaultResult = document.getElementById('vault-result');
  resultBanner.className = 'result-banner';
  vaultResult.className = 'vault-result';

  Diagnostics.log('pending', 'Calling /api/vault/store — creating Customer + vaulting PayPal account (no transaction.sale())...');
  await CodePanel.goToClientStep('submit');

  // >>> STEP:submit
  return fetch('/api/vault/store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentMethodNonce: nonce,
      customer,
      credentials: getCredentialOverrides(),
    }),
  })
  // <<< STEP:submit
    .then(async (res) => {
      await CodePanel.goToServerStep('vaultstore');
      return res.json();
    })
    .then((data) => {
      if (data.success) {
        const pm = (data.customer.paymentMethods || [])[0];
        Diagnostics.log('success', 'Customer created & PayPal account vaulted', data.raw);
        resultBanner.textContent = '✅ Linked successfully — no charge occurred.';
        resultBanner.classList.add('show', 'success');

        if (pm) {
          vaultResult.innerHTML = `💾 Customer ID: <code>${data.customer.id}</code> Payment Method Token: <code>${pm.token}</code><br>Go to <a href="/demos/vault/charge/">Vault → Charge Vaulted</a> to run a real transaction against this stored PayPal account, any time from now.`;
          vaultResult.classList.add('show');
        }
      } else {
        Diagnostics.log('error', 'Vault store failed', data.raw || data);
        resultBanner.textContent = `❌ Failed to store — ${data.message || data.error || 'see diagnostics'}`;
        resultBanner.classList.add('show', 'error');
      }
    })
    .catch((fetchErr) => {
      Diagnostics.log('error', 'Vault store request failed', { message: fetchErr.message });
      resultBanner.textContent = `❌ Request failed — ${fetchErr.message}`;
      resultBanner.classList.add('show', 'error');
    });
}

// >>> STEP:setup
async function setupPayPal(clientToken) {
  const note = document.getElementById('paypal-note');
  note.textContent = 'Setting up PayPal...';

  Diagnostics.log('pending', 'Creating Braintree client...');
  await CodePanel.goToClientStep('setup');

  braintree.client.create({ authorization: clientToken }, (err, clientInstance) => {
    if (err) {
      Diagnostics.log('error', 'braintree.client.create() failed', { message: err.message });
      note.textContent = 'Setup failed — see diagnostics.';
      return;
    }
    Diagnostics.log('success', 'Braintree client created');

    braintree.paypalCheckout.create({ client: clientInstance }, (ppErr, ppInstance) => {
      if (ppErr) {
        Diagnostics.log('error', 'paypalCheckout.create() failed', { message: ppErr.message });
        note.textContent = 'Setup failed — see diagnostics.';
        return;
      }
      paypalCheckoutInstance = ppInstance;
      Diagnostics.log('success', 'PayPal Checkout instance created');

      ppInstance.loadPayPalSDK({ vault: true }, () => {
        Diagnostics.log('success', 'PayPal JS SDK loaded (vault mode)');
        note.textContent = 'Click below to link a PayPal account — no charge will occur.';
        renderPayPalButton();
      });
    });
  });
}
// <<< STEP:setup

function resetDemo() {
  paypalCheckoutInstance = null;
  document.getElementById('paypal-button-container').innerHTML = '';
  document.getElementById('paypal-note').textContent = 'Waiting for client token...';

  document.getElementById('cust-first-name').value = 'Jane';
  document.getElementById('cust-last-name').value = 'Doe';
  document.getElementById('cust-email').value = 'jane.doe@example.com';

  const resultBanner = document.getElementById('result-banner');
  resultBanner.className = 'result-banner';
  resultBanner.textContent = '';

  const vaultResult = document.getElementById('vault-result');
  vaultResult.className = 'vault-result';
  vaultResult.innerHTML = '';
}

CodePanel.init({ clientPath: 'app.js' });

ConfigPanel.init({
  onTokenReady: (clientToken) => setupPayPal(clientToken),
  onClear: resetDemo,
});
