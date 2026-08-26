/**
 * ============================================================================
 * APPLE PAY DEMO — Braintree Apple Pay
 * ============================================================================
 * THE BIGGEST DIFFERENCE FROM EVERY OTHER DEMO IN THIS SUITE:
 * ----------------------------------------------------------------
 * Apple Pay is not a Braintree SDK component you can just "turn on" the way
 * Card, PayPal, Venmo, and Google Pay are here. It runs on Apple's own
 * `ApplePaySession` browser API, which:
 *
 *   - Only exists in Safari (or, as of iOS 18, other browsers running ON an
 *     iOS 18+ device — see the script tag in index.html). It does NOT exist
 *     in desktop Chrome/Firefox/Edge on a Mac or PC, full stop — there's no
 *     flag or polyfill that adds it, because the capability itself isn't
 *     implemented by those browser engines.
 *
 *   - Requires your DOMAIN to be pre-registered with Apple as an approved
 *     merchant domain, with a verification file hosted at a specific path
 *     (`/.well-known/apple-developer-merchantid-domain-association`). This
 *     is why Apple Pay is the only payment method in this suite that can't
 *     just work out of the box on `localhost` the way Google Pay's TEST
 *     mode does — Apple's validation genuinely checks the real domain.
 *
 * THE MERCHANT VALIDATION HANDSHAKE (the part with no equivalent elsewhere
 * in this suite):
 *   Before Apple will let a payment sheet open, Safari calls YOUR code back
 *   (`onvalidatemerchant`) and asks you to prove — via a server-to-server
 *   call to Apple, using a merchant certificate — that you're really the
 *   domain you claim to be. Braintree's `performValidation()` handles that
 *   round-trip for you. This step doesn't exist for Card/PayPal/Venmo/
 *   Google Pay because none of those require a domain-ownership proof.
 * ============================================================================
 */

Diagnostics.init('#diagnostics-panel');

let applePayInstance = null;

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
        return true;
      }
      Diagnostics.log('error', 'Transaction declined or failed', data.raw || data);
      resultBanner.textContent = `❌ Payment failed — ${data.message || data.error || 'see diagnostics'}`;
      resultBanner.classList.add('show', 'error');
      return false;
    })
    .catch((fetchErr) => {
      Diagnostics.log('error', 'Checkout request failed', { message: fetchErr.message });
      resultBanner.textContent = `❌ Request failed — ${fetchErr.message}`;
      resultBanner.classList.add('show', 'error');
      return false;
    });
}

function handleApplePayClick() {
  const amount = document.getElementById('order-amount').value;
  const desc = document.getElementById('order-desc').value;

  // createPaymentRequest() builds the object ApplePaySession needs — label
  // and amount shown on Apple's own payment sheet UI.
  const paymentRequest = applePayInstance.createPaymentRequest({
    total: {
      label: desc || 'Demo Order',
      amount: amount,
    },
  });

  Diagnostics.log('info', 'Apple Pay payment request built', paymentRequest);

  // "3" is the ApplePaySession API version — required by Apple's API, not
  // Braintree-specific. This is the actual native Apple Pay sheet opening.
  const session = new ApplePaySession(3, paymentRequest);

  // ----- THE MERCHANT VALIDATION HANDSHAKE (see file header) -----
  // Fired by Safari itself before showing anything to the user. This is
  // Apple checking "is this website really who it claims to be." Braintree's
  // performValidation() does the actual certificate-based round-trip to
  // Apple's servers on your behalf.
  // >>> STEP:merchantvalidation
  session.onvalidatemerchant = async (event) => {
    Diagnostics.log('pending', 'Apple requested merchant validation...');
    await CodePanel.goToClientStep('merchantvalidation');

    applePayInstance.performValidation({
      validationURL: event.validationURL,
      displayName: 'Braintree Demo Suite',
    })
      .then((merchantSession) => {
        Diagnostics.log('success', 'Merchant validated — Apple Pay sheet will now open');
        session.completeMerchantValidation(merchantSession);
      })
      .catch((err) => {
        Diagnostics.log('error', 'Merchant validation failed', { message: err.message });
        session.abort();
      });
  };
  // <<< STEP:merchantvalidation

  // Fired once the customer has authenticated with Face ID / Touch ID /
  // passcode and approved the payment on the Apple Pay sheet.
  session.onpaymentauthorized = async (event) => {
    Diagnostics.log('pending', 'Buyer authorized payment — tokenizing...');
    await CodePanel.goToClientStep('tokenize');

    // >>> STEP:tokenize
    applePayInstance.tokenize({ token: event.payment.token })
      .then((payload) => {
        Diagnostics.log('success', 'Nonce created', payload);

        return submitCheckout(payload.nonce).then((succeeded) => {
          // Reporting the outcome back to `session` is required — it's what
          // makes Apple's sheet show its own built-in success/failure
          // animation before closing, rather than just vanishing abruptly.
          session.completePayment(
            succeeded ? ApplePaySession.STATUS_SUCCESS : ApplePaySession.STATUS_FAILURE
          );
        });
      })
      .catch((err) => {
        Diagnostics.log('error', 'Apple Pay tokenize() failed', { message: err.message });
        session.completePayment(ApplePaySession.STATUS_FAILURE);
      });
  };
  // <<< STEP:tokenize

  session.oncancel = () => {
    Diagnostics.log('info', 'Buyer canceled the Apple Pay sheet');
  };

  session.begin();
}

async function setupApplePay(clientToken) {
  const note = document.getElementById('apay-note');
  const btn = document.getElementById('apple-pay-btn');

  // This check is why Apple Pay can't be treated like the other four demos
  // — most visitors to this page (anyone not on Safari/an Apple device)
  // simply won't have this API at all, and that's expected, not an error.
  if (!window.ApplePaySession) {
    note.textContent = 'Apple Pay isn\u2019t available in this browser. Open this page in Safari on a Mac, iPhone, or iPad to test it.';
    Diagnostics.log('info', 'window.ApplePaySession is not defined — this browser/device doesn\u2019t support Apple Pay.');
    return;
  }

  if (!ApplePaySession.canMakePayments()) {
    note.textContent = 'This device supports Apple Pay, but no card is set up in Wallet yet.';
    Diagnostics.log('info', 'ApplePaySession.canMakePayments() returned false.');
    return;
  }

  note.textContent = 'Creating Braintree client...';
  Diagnostics.log('pending', 'Creating Braintree client...');
  await CodePanel.goToClientStep('setup');

  // >>> STEP:setup
  braintree.client.create({ authorization: clientToken }, (err, clientInstance) => {
    if (err) {
      Diagnostics.log('error', 'braintree.client.create() failed', { message: err.message });
      note.textContent = 'Setup failed — see diagnostics.';
      return;
    }
    Diagnostics.log('success', 'Braintree client created');

    braintree.applePay.create({ client: clientInstance }, (apErr, instance) => {
      if (apErr) {
        Diagnostics.log('error', 'applePay.create() failed', { message: apErr.message });
        note.textContent = 'Setup failed — see diagnostics. (This often means Apple Pay isn\u2019t configured on this merchant account, or this domain isn\u2019t registered with Apple yet.)';
        return;
      }

      applePayInstance = instance;
      Diagnostics.log('success', 'Apple Pay instance created');

      note.textContent = 'Click below — this opens the real Apple Pay sheet.';
      btn.style.display = 'inline-block';
    });
  });
  // <<< STEP:setup
}

function resetApplePayDemo() {
  applePayInstance = null;
  document.getElementById('apple-pay-btn').style.display = 'none';
  document.getElementById('apay-note').textContent = 'Waiting for client token...';

  document.getElementById('order-amount').value = '49.00';
  document.getElementById('order-desc').value = 'Demo order — Apple Pay';
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
  onTokenReady: (clientToken) => setupApplePay(clientToken),
  onClear: resetApplePayDemo,
});

document.getElementById('apple-pay-btn').addEventListener('click', handleApplePayClick);
