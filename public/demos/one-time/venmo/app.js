/**
 * ============================================================================
 * VENMO DEMO — Braintree Venmo, Desktop QR Code Flow
 * ============================================================================
 * VENMO'S CORE ASSUMPTION: THE CUSTOMER IS ON THEIR PHONE
 * ----------------------------------------------------------
 * Venmo is fundamentally an app-switch payment method — the normal flow is
 * "customer is checking out on their phone's mobile browser → tapping Pay
 * with Venmo → their phone hands off directly to the Venmo app already
 * installed → they approve → control returns to the browser." No popup, no
 * QR code needed, because the phone IS the device with the Venmo app on it.
 *
 * THE PROBLEM THIS DEMO SOLVES: WHAT ABOUT DESKTOP?
 * ----------------------------------------------------
 * A desktop browser has no Venmo app to switch into. Braintree's answer is
 * the `allowDesktop: true` option below — when set, calling tokenize() on a
 * desktop browser makes the SDK automatically display a QR code overlay
 * (Braintree renders and injects this UI itself — notice there's no code
 * here building a QR code image). You scan that QR code with your PHONE's
 * Venmo app, approve the payment there, and Braintree's SDK is quietly
 * polling in the background the whole time. The moment you approve on your
 * phone, the tokenize() promise on the DESKTOP page resolves automatically.
 *
 * This is worth pointing out explicitly in a demo: two different devices
 * are involved in one payment, and the desktop page has no idea anything
 * happened until the SDK's background polling picks it up — there's no
 * "refresh" or manual step, it just resolves.
 *
 * `hasTokenizationResult()` / the "resuming" logic further down handles the
 * OTHER scenario — a customer on an actual mobile browser who app-switched
 * away to Venmo and is now being redirected back into this same page.
 * ============================================================================
 */

Diagnostics.init('#diagnostics-panel');

let venmoInstance = null;

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

// tokenize() is doing double duty here: on mobile it triggers the app
// switch; on desktop (allowDesktop: true) it triggers Braintree's own QR
// overlay. Either way, this promise doesn't resolve until the customer has
// actually approved on their phone — that could be seconds or minutes later.
async function handleVenmoClick() {
  if (!venmoInstance) {
    Diagnostics.log('error', 'Venmo instance not ready yet');
    return;
  }

  const btn = document.getElementById('venmo-btn');
  btn.disabled = true;
  btn.textContent = 'Waiting for scan...';

  Diagnostics.log('pending', 'tokenize() called — Braintree will display a QR code overlay to scan with the Venmo app.');
  await CodePanel.goToClientStep('tokenize');

  // >>> STEP:tokenize
  venmoInstance.tokenize()
    .then((payload) => {
      Diagnostics.log('success', 'Nonce created', payload);
      document.getElementById('venmo-note').textContent =
        `Approved by ${payload.details?.username || 'Venmo user'} — submitting transaction...`;
      return submitCheckout(payload.nonce);
    })
    // <<< STEP:tokenize
    .catch((err) => {
      if (err.code === 'VENMO_CANCELED') {
        Diagnostics.log('info', 'Buyer canceled or closed the QR code overlay before scanning/approving', { message: err.message });
      } else {
        Diagnostics.log('error', 'Venmo tokenize() failed', { code: err.code, message: err.message });
      }
      const resultBanner = document.getElementById('result-banner');
      resultBanner.textContent = 'Venmo payment was not completed.';
      resultBanner.className = 'result-banner show error';
    })
    .finally(() => {
      btn.disabled = false;
      btn.textContent = 'Pay with Venmo';
    });
}

// >>> STEP:setup
async function setupVenmo(clientToken) {
  const note = document.getElementById('venmo-note');
  const btn = document.getElementById('venmo-btn');
  note.textContent = 'Setting up Venmo...';

  Diagnostics.log('pending', 'Creating Braintree client...');
  await CodePanel.goToClientStep('setup');

  braintree.client.create({ authorization: clientToken }, (err, clientInstance) => {
    if (err) {
      Diagnostics.log('error', 'braintree.client.create() failed', { message: err.message });
      note.textContent = 'Setup failed — see diagnostics.';
      return;
    }
    Diagnostics.log('success', 'Braintree client created');

    // allowDesktop: true is what enables the QR-code flow on a desktop
    // browser — without it, Venmo would only work in a mobile browser
    // capable of app-switching directly into the Venmo app.
    // allowDesktop: true is the single flag that makes the QR-code flow
    // possible at all. Without it, isBrowserSupported() would return false
    // on any non-mobile browser and Venmo simply wouldn't be offered.
    braintree.venmo.create({
      client: clientInstance,
      allowDesktop: true,
      paymentMethodUsage: 'single_use',
    }, (vErr, instance) => {
      if (vErr) {
        Diagnostics.log('error', 'venmo.create() failed', { message: vErr.message });
        note.textContent = 'Setup failed — see diagnostics.';
        return;
      }

      venmoInstance = instance;
      Diagnostics.log('success', 'Venmo instance created', {
        isBrowserSupported: instance.isBrowserSupported(),
      });

      // If the page was reloaded after an app-switch redirect (mobile use
      // case), this picks up the in-progress result automatically.
      if (instance.hasTokenizationResult()) {
        Diagnostics.log('info', 'Detected an in-progress Venmo result — resuming...');
        instance.tokenize()
          .then((payload) => {
            Diagnostics.log('success', 'Nonce created (resumed)', payload);
            return submitCheckout(payload.nonce);
          })
          .catch((resumeErr) => {
            Diagnostics.log('error', 'Failed to resume Venmo result', { message: resumeErr.message });
          });
      }

      note.textContent = 'Click below — a QR code will appear. Scan it with the Venmo app on your phone to approve.';
      btn.disabled = false;
    });
  });
}
// <<< STEP:setup

function resetVenmoDemo() {
  venmoInstance = null;

  const btn = document.getElementById('venmo-btn');
  btn.disabled = true;
  btn.textContent = 'Pay with Venmo';

  document.getElementById('venmo-note').textContent = 'Waiting for client token...';
  document.getElementById('venmo-qr-mount').innerHTML = '';

  document.getElementById('order-amount').value = '49.00';
  document.getElementById('order-desc').value = 'Demo order — Venmo';
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
  onTokenReady: (clientToken) => setupVenmo(clientToken),
  onClear: resetVenmoDemo,
});

document.getElementById('venmo-btn').addEventListener('click', handleVenmoClick);
