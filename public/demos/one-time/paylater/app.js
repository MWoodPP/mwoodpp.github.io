/**
 * ============================================================================
 * PAY LATER DEMO — Braintree PayPal Checkout, Pay Later funding source
 * ============================================================================
 * PAY LATER IS NOT A SEPARATE PRODUCT FROM PAYPAL — IT'S A FUNDING SOURCE
 * --------------------------------------------------------------------------
 * This might be the single most common point of confusion for anyone new
 * to Braintree's PayPal integration: "Pay Later" (PayPal's BNPL / Buy Now
 * Pay Later offering) isn't a different SDK component or a different
 * tokenize flow — it's the exact same `braintree.paypalCheckout` component
 * as the plain PayPal tab in this suite, just rendered with a different
 * `fundingSource` value (`paypal.FUNDING.PAYLATER` instead of the default
 * `paypal.FUNDING.PAYPAL`). Compare this file's button-rendering code to
 * the PayPal demo's — the createOrder / onApprove / tokenize lifecycle is
 * identical line for line.
 *
 * WHAT ACTUALLY DIFFERS: ELIGIBILITY IS DYNAMIC AND OPAQUE TO YOU
 * ---------------------------------------------------------------
 * Not every buyer qualifies for Pay Later, and not every order amount
 * qualifies either — PayPal evaluates eligibility (soft credit check,
 * amount thresholds, buyer history, country) at render time, and if the
 * buyer/amount isn't eligible, `paypal.Buttons({fundingSource: PAYLATER})`
 * will simply refuse to render at all — no error, the button just doesn't
 * appear. This is conceptually similar to Google Pay's `isReadyToPay()`
 * gate, except there's no explicit check you can call yourself; you find
 * out by attempting to render and seeing whether anything shows up.
 *
 * As of this writing, the two US offers and their amount ranges are:
 *   - Pay in 4:      $35   – $1,500
 *   - Pay Monthly:   $199  – $10,000
 * An amount outside BOTH ranges (e.g. $10) will correctly show no button
 * at all — that's expected behavior, not a bug to chase.
 *
 * THE REQUIRED MESSAGING COMPONENT (easy to forget, not optional)
 * -------------------------------------------------------------------
 * Real Pay Later integrations are contractually required to display PayPal's
 * "as low as $X/mo" messaging near the offer — this isn't a nice-to-have UI
 * touch, it's a compliance/disclosure requirement tied to lending regulation
 * around presenting financing terms. That's what `paypal.Message()` renders
 * below. If you only render the button and skip the message component, the
 * integration is incomplete even though the payment flow itself would still
 * technically work.
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

function renderMessage() {
  const mount = document.getElementById('paylater-message-mount');
  mount.innerHTML = '';

  const amount = document.getElementById('order-amount').value;

  // paypal.Messages() (plural — an easy typo, the older/deprecated SDK used
  // the singular paypal.Message()) is entirely separate from paypal.Buttons()
  // — it's PayPal's own rendered disclosure widget, not something Braintree
  // constructs. It reads its own eligibility independently of the button,
  // so it's possible (and normal) to see the message render even in cases
  // where the button ultimately doesn't, or vice versa.
  //
  // Wrapped in try/catch deliberately: this is a secondary, disclosure-only
  // widget. If it fails for any reason, that should never take down the
  // actual payment button below it — the two are independent render calls
  // sharing one loadPayPalSDK() callback, and one throwing must not stop
  // the other from running.
  try {
    if (typeof window.paypal.Messages !== 'function') {
      Diagnostics.log('error', 'paypal.Messages is not available — check that components: "messages" was included in loadPayPalSDK().');
      return;
    }

    window.paypal.Messages({
      amount: amount,
      placement: 'product',
      style: {
        layout: 'text',
        logo: { type: 'inline' },
      },
    }).render('#paylater-message-mount');

    Diagnostics.log('info', 'Pay Later messaging component rendered', { amount, placement: 'product' });
  } catch (err) {
    Diagnostics.log('error', 'paypal.Messages() render failed', { message: err.message });
  }
}

function renderPayLaterButton() {
  const container = document.getElementById('paylater-button-container');
  container.innerHTML = '';

  window.paypal.Buttons({
    // This is the one line that actually distinguishes this file from the
    // plain PayPal demo — everything else in this Buttons() config mirrors
    // it exactly.
    fundingSource: window.paypal.FUNDING.PAYLATER,

    // >>> STEP:createorder
    createOrder: function () {
      const amount = document.getElementById('order-amount').value;
      Diagnostics.log('pending', `Creating Pay Later order for $${amount}...`);
      CodePanel.goToClientStep('createorder');

      return paypalCheckoutInstance.createPayment({
        flow: 'checkout',
        amount: amount,
        currency: 'USD',
        intent: 'capture',
      }).then((paymentId) => {
        Diagnostics.log('success', 'Order created', { paymentId });
        return paymentId;
      }).catch((err) => {
        Diagnostics.log('error', 'createPayment() failed', { message: err.message });
        throw err;
      });
    },
    // <<< STEP:createorder

    // >>> STEP:tokenize
    onApprove: function (data) {
      Diagnostics.log('pending', 'Buyer approved financing terms — tokenizing...');
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
      Diagnostics.log('info', 'Buyer closed the Pay Later window before completing', data);
      const resultBanner = document.getElementById('result-banner');
      resultBanner.textContent = 'Payment cancelled by buyer.';
      resultBanner.className = 'result-banner show error';
    },

    onError: function (err) {
      Diagnostics.log('error', 'Pay Later Buttons error', { message: err.message || String(err) });
    },

  }).render('#paylater-button-container').then(() => {
    // Rendering "succeeding" here doesn't guarantee a button actually
    // appeared — see the eligibility note in the file header. Worth
    // checking the container in the DOM if this logs success but nothing
    // is visible on screen; that's the eligibility gate at work, not a bug.
    Diagnostics.log('success', 'Pay Later button render() resolved (may or may not be visible — depends on live eligibility)');
  }).catch((err) => {
    Diagnostics.log('error', 'Pay Later button failed to render', { message: err.message });
  });
}

function submitCheckout(nonce) {
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
function setupPayLater(clientToken) {
  const note = document.getElementById('paylater-note');
  note.textContent = 'Setting up Pay Later...';

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
      Diagnostics.log('success', 'PayPal Checkout instance created (shared by PayPal + Pay Later)');

      // components: 'buttons,messages' is required here — the plain PayPal
      // demo only needs 'buttons' since it doesn't render the disclosure
      // widget. Forgetting 'messages' here would make paypal.Message()
      // unavailable even though the SDK script loaded successfully.
      ppInstance.loadPayPalSDK({
        currency: 'USD',
        intent: 'capture',
        components: 'buttons,messages',
      }, () => {
        Diagnostics.log('success', 'PayPal JS SDK loaded (buttons + messages components)');
        note.textContent = 'If eligible, a Pay Later button will appear below along with financing terms.';

        // Called as two independent steps (each already wrapped in its own
        // try/catch) rather than one depending on the other succeeding —
        // see the try/catch inside renderMessage() for why this matters.
        renderMessage();
        renderPayLaterButton();
      });
    });
  });
}
// <<< STEP:setup

function resetPayLaterDemo() {
  paypalCheckoutInstance = null;
  document.getElementById('paylater-button-container').innerHTML = '';
  document.getElementById('paylater-message-mount').innerHTML = '';
  document.getElementById('paylater-note').textContent = 'Waiting for client token...';

  document.getElementById('order-amount').value = '199.00';
  document.getElementById('order-desc').value = 'Demo order — Pay Later';
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
  onTokenReady: (clientToken) => setupPayLater(clientToken),
  onClear: resetPayLaterDemo,
});
