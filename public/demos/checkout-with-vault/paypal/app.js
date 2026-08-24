/**
 * ============================================================================
 * CHECKOUT WITH VAULT — PayPal
 * ============================================================================
 * ONE REAL DIFFERENCE FROM THE CARD VERSION OF THIS SAME PATTERN:
 * ------------------------------------------------------------------
 * With Card, vaulting alongside a purchase is invisible to the customer —
 * they just see a normal card form; the "save for later" behavior happens
 * entirely server-side via storeInVaultOnSuccess. PayPal is different:
 * PayPal requires buyers to see and explicitly consent to a BILLING
 * AGREEMENT before you're allowed to charge their account again in the
 * future. That's what `requestBillingAgreement: true` (below, in
 * createPayment) does — it tells PayPal's approval screen to show that
 * consent step to the buyer during the popup flow itself, not just quietly
 * happen on the backend.
 *
 * Everything else — createOrder → onApprove → tokenizePayment → server
 * call with saveInVault: true — is identical to the Card version and to
 * the plain PayPal demo under "One Time Payment."
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

function getBillingAddress() {
  return {
    streetAddress: document.getElementById('addr-street')?.value || '',
    locality: document.getElementById('addr-city')?.value || '',
    region: document.getElementById('addr-state')?.value || '',
    postalCode: document.getElementById('addr-zip')?.value || '',
    countryCodeAlpha2: document.getElementById('addr-country')?.value || '',
  };
}

function renderPayPalButton() {
  const container = document.getElementById('paypal-button-container');
  container.innerHTML = '';

  window.paypal.Buttons({
    fundingSource: window.paypal.FUNDING.PAYPAL,

    // >>> STEP:createorder
    createOrder: function () {
      const amount = document.getElementById('order-amount').value;
      const saveInVault = document.getElementById('save-vault-checkbox').checked;

      Diagnostics.log('pending', `Creating PayPal order for $${amount}${saveInVault ? ' (requesting billing agreement)' : ''}...`);
      CodePanel.goToClientStep('createorder');

      const createPaymentOptions = {
        flow: 'checkout',
        amount: amount,
        currency: 'USD',
        intent: 'capture',
      };

      // See file header — this is what makes PayPal's approval screen show
      // the buyer an explicit "allow future payments" consent step.
      if (saveInVault) {
        createPaymentOptions.requestBillingAgreement = true;
      }

      return paypalCheckoutInstance.createPayment(createPaymentOptions).then((paymentId) => {
        Diagnostics.log('success', 'PayPal order created', { paymentId });
        return paymentId;
      }).catch((err) => {
        Diagnostics.log('error', 'createPayment() failed', { message: err.message });
        throw err;
      });
    },
    // <<< STEP:createorder

    // >>> STEP:tokenize
    onApprove: function (data) {
      Diagnostics.log('pending', 'Buyer approved — tokenizing...');
      CodePanel.goToClientStep('tokenize');

      return paypalCheckoutInstance.tokenizePayment(data).then((payload) => {
        Diagnostics.log('success', 'Nonce created', payload);
        return submitCheckout(payload.nonce);
      }).catch((err) => {
        Diagnostics.log('error', 'tokenizePayment() failed', { message: err.message });
      });
    },
    // <<< STEP:tokenize

    onCancel: function (data) {
      Diagnostics.log('info', 'Buyer closed the PayPal window before completing', data);
      const resultBanner = document.getElementById('result-banner');
      resultBanner.textContent = 'Payment cancelled by buyer.';
      resultBanner.className = 'result-banner show error';
    },

    onError: function (err) {
      Diagnostics.log('error', 'PayPal Buttons error', { message: err.message || String(err) });
    },

  }).render('#paypal-button-container').then(() => {
    Diagnostics.log('success', 'PayPal button rendered');
  });
}

function submitCheckout(nonce) {
  const amount = document.getElementById('order-amount').value;
  const customer = getCustomerDetails();
  const billingAddress = getBillingAddress();
  const saveInVault = document.getElementById('save-vault-checkbox').checked;
  const resultBanner = document.getElementById('result-banner');
  const vaultResult = document.getElementById('vault-result');
  resultBanner.className = 'result-banner';
  vaultResult.className = 'vault-result';

  Diagnostics.log('info', 'Customer & billing details attached to transaction', {
    customer,
    billingAddress,
    saveInVault,
  });

  Diagnostics.log('pending', `Submitting transaction.sale() for $${amount}...`);
  CodePanel.goToClientStep('submit');

  // >>> STEP:submit
  return fetch('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentMethodNonce: nonce,
      amount,
      customer,
      billingAddress,
      saveInVault,
      credentials: getCredentialOverrides(),
    }),
  })
  // <<< STEP:submit
    .then((res) => {
      CodePanel.goToServerStep('checkout');
      return res.json();
    })
    .then((data) => {
      if (data.success) {
        Diagnostics.log('success', `Transaction ${data.transaction.status}`, data.raw);
        resultBanner.textContent = `✅ Payment successful — Transaction ID: ${data.transaction.id} (${data.transaction.status})`;
        resultBanner.classList.add('show', 'success');

        if (saveInVault && data.transaction.customer && data.transaction.paymentMethodToken) {
          Diagnostics.log('success', 'PayPal account vaulted alongside this purchase', {
            customerId: data.transaction.customer.id,
            paymentMethodToken: data.transaction.paymentMethodToken,
          });
          vaultResult.innerHTML = `💾 Vaulted for future use — Customer ID: <code>${data.transaction.customer.id}</code> Payment Method Token: <code>${data.transaction.paymentMethodToken}</code><br>You can charge this again later from the <a href="/demos/vault/charge/">Vault → Charge Vaulted</a> demo.`;
          vaultResult.classList.add('show');
        }
      } else {
        Diagnostics.log('error', 'Transaction declined or failed', data.raw || data);
        resultBanner.textContent = `❌ Payment failed — ${data.message || data.error || 'see diagnostics'}`;
        resultBanner.classList.add('show', 'error');
      }
    })
    .catch((fetchErr) => {
      Diagnostics.log('error', 'Checkout request failed', { message: fetchErr.message });
      resultBanner.textContent = `❌ Request failed — ${fetchErr.message}`;
      resultBanner.classList.add('show', 'error');
    });
}

// >>> STEP:setup
function setupPayPal(clientToken) {
  const note = document.getElementById('paypal-note');
  note.textContent = 'Setting up PayPal...';

  Diagnostics.log('pending', 'Creating Braintree client...');
  CodePanel.goToClientStep('setup');

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

      ppInstance.loadPayPalSDK({ currency: 'USD', intent: 'capture' }, () => {
        Diagnostics.log('success', 'PayPal JS SDK loaded');
        note.textContent = 'Click the button below to pay — this opens a real PayPal sandbox window.';
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

  document.getElementById('order-amount').value = '49.00';
  document.getElementById('order-desc').value = 'Demo order — Checkout with Vault (PayPal)';
  document.getElementById('cust-first-name').value = 'Jane';
  document.getElementById('cust-last-name').value = 'Doe';
  document.getElementById('cust-email').value = 'jane.doe@example.com';
  document.getElementById('addr-street').value = '2211 N 1st St';
  document.getElementById('addr-city').value = 'San Jose';
  document.getElementById('addr-state').value = 'CA';
  document.getElementById('addr-zip').value = '95131';
  document.getElementById('addr-country').value = 'US';
  document.getElementById('save-vault-checkbox').checked = true;

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
