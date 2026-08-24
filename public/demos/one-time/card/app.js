/**
 * ============================================================================
 * CARD DEMO — Braintree Hosted Fields
 * ============================================================================
 * WHAT PROBLEM DOES HOSTED FIELDS SOLVE?
 * ----------------------------------------
 * If you build your own <input type="text"> for a card number and read its
 * value in your JavaScript, that raw card number has now touched YOUR
 * website's code — which puts your entire site in scope for the strictest
 * tier of PCI DSS compliance (SAQ D), even though you never store the card.
 *
 * Hosted Fields solves this by rendering the actual card number / expiry /
 * CVV inputs as invisible IFRAMES that Braintree controls, layered exactly
 * on top of the boxes you see on screen (#hf-number, #hf-expiration,
 * #hf-cvv below). The customer is typing directly into Braintree's iframe,
 * not into your page's DOM — your JavaScript never has access to the raw
 * digits, even though visually it looks like a normal form. This is what
 * drops most merchants down to the much lighter SAQ A-EP.
 *
 * THE FLOW, END TO END:
 *   1. Client token arrives (from ConfigPanel / server.js)
 *   2. braintree.client.create() — general-purpose Braintree client object
 *   3. braintree.hostedFields.create() — mounts the secure iframes into the
 *      three empty <div> containers in index.html
 *   4. Customer types their card details directly into those iframes
 *   5. On submit, hostedFieldsInstance.tokenize() asks Braintree's servers
 *      to validate the card and exchange it for a one-time-use NONCE —
 *      this is the moment the card number leaves the browser, and it goes
 *      straight to Braintree, not through your server or your JS at all
 *   6. That nonce (never the card number) gets sent to YOUR server, which
 *      uses it to create the actual transaction (see server.js)
 *
 * The step-marker comments below (search for "STEP:") are read by the Code
 * Panel (see /shared/code-panel.js) to highlight whichever block is
 * actively running — they're plain comments and don't affect execution.
 * ============================================================================
 */

Diagnostics.init('#diagnostics-panel');

let hostedFieldsInstance = null;

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

// braintree.client.create() → braintree.hostedFields.create() is the
// standard two-step setup pattern you'll see repeated (with a different
// second step) across every payment method in this suite. The client
// object is the shared foundation; each payment method's own component
// builds on top of it.
// >>> STEP:setup
function setupHostedFields(clientToken) {
  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;

  Diagnostics.log('pending', 'Creating Braintree client...');
  CodePanel.goToClientStep('setup');

  braintree.client.create({ authorization: clientToken }, (err, clientInstance) => {
    if (err) {
      Diagnostics.log('error', 'braintree.client.create() failed', { message: err.message });
      return;
    }
    Diagnostics.log('success', 'Braintree client created');

    Diagnostics.log('pending', 'Setting up Hosted Fields...');

    braintree.hostedFields.create({
      client: clientInstance,
      styles: {
        input: { 'font-size': '14px', color: '#1a1a2e' },
      },
      fields: {
        number: { selector: '#hf-number', placeholder: '4111 1111 1111 1111' },
        expirationDate: { selector: '#hf-expiration', placeholder: 'MM/YY' },
        cvv: { selector: '#hf-cvv', placeholder: 'CVV' },
      },
    }, (hfErr, hfInstance) => {
      if (hfErr) {
        Diagnostics.log('error', 'hostedFields.create() failed', { message: hfErr.message });
        return;
      }
      hostedFieldsInstance = hfInstance;
      Diagnostics.log('success', 'Hosted Fields ready — card entry enabled');
      submitBtn.disabled = false;
    });
  });
}
// <<< STEP:setup

// This function is triggered by the "Submit Payment" button. Everything
// before the tokenize() call happens using data already sitting inside
// Braintree's Hosted Fields iframes — your code never sees it. The
// tokenize() call is the exact moment the card number leaves the browser.
async function handleSubmit() {
  const submitBtn = document.getElementById('submit-btn');
  const resultBanner = document.getElementById('result-banner');
  resultBanner.className = 'result-banner';

  if (!hostedFieldsInstance) {
    Diagnostics.log('error', 'Hosted Fields not initialized yet');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Processing...';

  Diagnostics.log('pending', 'Tokenizing card details...');
  CodePanel.goToClientStep('tokenize');

  // >>> STEP:tokenize
  hostedFieldsInstance.tokenize((err, payload) => {
    if (err) {
      Diagnostics.log('error', 'Tokenization failed', { message: err.message });
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Payment';
      return;
    }

    // `payload.nonce` is the one-time-use reference described above.
    // `payload.details` includes non-sensitive metadata Braintree deems
    // safe to hand back to your JS (card type, last 4 digits) — useful
    // for showing a confirmation UI — but never the full card number.
    Diagnostics.log('success', 'Nonce created', payload);
    // <<< STEP:tokenize

    const amount = document.getElementById('order-amount').value;
    const customer = getCustomerDetails();
    const billingAddress = getBillingAddress();

    Diagnostics.log('info', 'Customer & billing details attached to transaction', {
      customer,
      billingAddress,
    });

    Diagnostics.log('pending', `Submitting transaction.sale() for $${amount}...`);
    CodePanel.goToClientStep('submit');

    // >>> STEP:submit
    fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentMethodNonce: payload.nonce,
        amount,
        customer,
        billingAddress,
        credentials: getCredentialOverrides(),
      }),
    })
    // <<< STEP:submit
      .then((res) => {
        // The request has left the browser — this is the moment to flip
        // the Code Panel over to server.js and show the handler that's
        // about to process it.
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
      })
      .finally(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Payment';
      });
  });
}

function resetCardDemo() {
  // Tear down the existing Hosted Fields instance so stale field state
  // (and its event bindings) don't linger after a clear.
  if (hostedFieldsInstance) {
    hostedFieldsInstance.teardown((err) => {
      if (err) {
        Diagnostics.log('error', 'Hosted Fields teardown failed', { message: err.message });
      }
      // Braintree removes the field iframes on teardown — put the empty
      // containers back so a fresh hostedFields.create() has somewhere to mount.
      ['hf-number', 'hf-expiration', 'hf-cvv'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
      });
    });
    hostedFieldsInstance = null;
  }

  document.getElementById('order-amount').value = '49.00';
  document.getElementById('order-desc').value = 'Demo order — Card';
  document.getElementById('cust-first-name').value = 'Jane';
  document.getElementById('cust-last-name').value = 'Doe';
  document.getElementById('cust-email').value = 'jane.doe@example.com';
  document.getElementById('addr-street').value = '2211 N 1st St';
  document.getElementById('addr-city').value = 'San Jose';
  document.getElementById('addr-state').value = 'CA';
  document.getElementById('addr-zip').value = '95131';
  document.getElementById('addr-country').value = 'US';

  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submit Payment';

  const resultBanner = document.getElementById('result-banner');
  resultBanner.className = 'result-banner';
  resultBanner.textContent = '';
}

CodePanel.init({ clientPath: 'app.js' });

ConfigPanel.init({
  onTokenReady: (clientToken) => setupHostedFields(clientToken),
  onClear: resetCardDemo,
});

document.getElementById('submit-btn').addEventListener('click', handleSubmit);
