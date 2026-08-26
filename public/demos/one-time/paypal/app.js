/**
 * ============================================================================
 * PAYPAL DEMO — Braintree PayPal Checkout
 * ============================================================================
 * HOW THIS DIFFERS FUNDAMENTALLY FROM THE CARD DEMO:
 * -----------------------------------------------------
 * With Hosted Fields, the customer types their card into an invisible
 * iframe that LOOKS like part of your page but is actually Braintree's.
 * PayPal works differently: the customer is sent to log in on PayPal's own
 * domain (paypal.com) in a real popup window — there's no illusion of it
 * being "on your site" at all, and that's intentional. It means your site
 * never sees the customer's PayPal credentials, and PayPal handles their
 * own authentication/fraud checks in an environment they fully control.
 *
 * THE TWO-PHASE LIFECYCLE (this is the part worth walking through slowly):
 *
 *   PHASE 1 — createOrder / createPayment
 *     Fired the moment the customer clicks the PayPal button. Your code
 *     tells Braintree "here's the amount," and Braintree creates a
 *     pending PayPal order behind the scenes, handing back a payment ID.
 *
 *   PHASE 2 — onApprove / tokenizePayment
 *     Fired after the customer logs into PayPal (in the popup) and clicks
 *     "Continue to confirm." At this point PayPal has confirmed the buyer's
 *     identity and consent, but you still need to exchange that approval
 *     for a NONCE — same concept as the Card demo's tokenize() step, just
 *     arriving via a different path (a real popup instead of an iframe).
 *
 *   Only after tokenizePayment resolves do we have a nonce to hand to your
 *   server — exactly the same server-side call (server.js /api/checkout)
 *   as every other payment method in this suite. This is the payoff of
 *   Braintree's model: no matter how different card, PayPal, Venmo, and
 *   Google Pay look on the frontend, they all converge on the same nonce
 *   → server → transaction.sale() pattern.
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

// Unlike Hosted Fields (which mounts into containers YOU style),
// paypal.Buttons().render() draws PayPal's own official button graphic —
// this is a brand/trust requirement from PayPal, not a Braintree limitation.
// The three callbacks below (createOrder, onApprove, onCancel/onError) are
// where all of the actual integration logic lives.
function renderPayPalButton() {
  const container = document.getElementById('paypal-button-container');
  container.innerHTML = '';

  window.paypal.Buttons({
    fundingSource: window.paypal.FUNDING.PAYPAL,

    // ----- PHASE 1: create the pending order -----
    // >>> STEP:createorder
    createOrder: async function () {
      const amount = document.getElementById('order-amount').value;
      Diagnostics.log('pending', `Creating PayPal order for $${amount}...`);
      await CodePanel.goToClientStep('createorder');

      return paypalCheckoutInstance.createPayment({
        flow: 'checkout',
        amount: amount,
        currency: 'USD',
        intent: 'capture',
      }).then((paymentId) => {
        Diagnostics.log('success', 'PayPal order created', { paymentId });
        return paymentId;
      }).catch((err) => {
        Diagnostics.log('error', 'createPayment() failed', { message: err.message });
        throw err;
      });
    },
    // <<< STEP:createorder

    // ----- PHASE 2: buyer approved in the popup — exchange for a nonce -----
    // >>> STEP:tokenize
    onApprove: async function (data) {
      Diagnostics.log('pending', 'Buyer approved — tokenizing payment...');
      // NOTE: no pause here (before calling tokenizePayment). The PayPal
      // popup has ALREADY shown approval and is actively waiting for this
      // callback to finish promptly — pausing before responding can make
      // PayPal's popup think something went wrong and show its own
      // "lost track of you" recovery screen. The checkpoint below fires
      // AFTER tokenization completes instead, narrating what just
      // happened rather than gating what's about to happen.

      return paypalCheckoutInstance.tokenizePayment(data).then(async (payload) => {
        Diagnostics.log('success', 'Nonce created', payload);
        await CodePanel.goToClientStep('tokenize');
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

async function submitCheckout(nonce) {
  const amount = document.getElementById('order-amount').value;
  const customer = getCustomerDetails();
  const billingAddress = getBillingAddress();
  const resultBanner = document.getElementById('result-banner');
  resultBanner.className = 'result-banner';

  Diagnostics.log('info', 'Customer & billing details attached to transaction', {
    customer,
    billingAddress,
  });

  Diagnostics.log('pending', `Submitting transaction.sale() for $${amount}...`);
  await CodePanel.goToClientStep('submit');

  // >>> STEP:submit
  return fetch('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentMethodNonce: nonce,
      amount,
      customer,
      billingAddress,
      credentials: getCredentialOverrides(),
    }),
  })
  // <<< STEP:submit
    .then(async (res) => {
      await CodePanel.goToServerStep('checkout');
      return res.json();
    })
    .then((data) => {
      if (data.success) {
        Diagnostics.log('success', `Transaction ${data.transaction.status}`, data.raw);
        resultBanner.textContent = `✅ Payment successful — Transaction ID: ${data.transaction.id} (${data.transaction.status})`;
        resultBanner.classList.add('show', 'success');
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

      ppInstance.loadPayPalSDK({ currency: 'USD', intent: 'capture' }, () => {
        Diagnostics.log('success', 'PayPal JS SDK loaded');
        note.textContent = 'Click the button below to pay — this opens a real PayPal sandbox window.';
        renderPayPalButton();
      });
    });
  });
}
// <<< STEP:setup

function resetPayPalDemo() {
  paypalCheckoutInstance = null;
  document.getElementById('paypal-button-container').innerHTML = '';
  document.getElementById('paypal-note').textContent = 'Waiting for client token...';

  document.getElementById('order-amount').value = '49.00';
  document.getElementById('order-desc').value = 'Demo order — PayPal';
  document.getElementById('cust-first-name').value = 'Jane';
  document.getElementById('cust-last-name').value = 'Doe';
  document.getElementById('cust-email').value = 'jane.doe@example.com';
  document.getElementById('addr-street').value = '2211 N 1st St';
  document.getElementById('addr-city').value = 'San Jose';
  document.getElementById('addr-state').value = 'CA';
  document.getElementById('addr-zip').value = '95131';
  document.getElementById('addr-country').value = 'US';

  const resultBanner = document.getElementById('result-banner');
  resultBanner.className = 'result-banner';
  resultBanner.textContent = '';
}

CodePanel.init({ clientPath: 'app.js' });

ConfigPanel.init({
  onTokenReady: (clientToken) => setupPayPal(clientToken),
  onClear: resetPayPalDemo,
});
