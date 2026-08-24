/**
 * ============================================================================
 * GOOGLE PAY DEMO — Braintree + Google Pay API
 * ============================================================================
 * TWO SDKs WORKING TOGETHER
 * ---------------------------
 * This is the only payment method in this suite that involves TWO separate
 * third-party SDKs instead of one: Google's own `pay.js` (which talks to
 * Google's servers and renders the actual Google Pay sheet) AND Braintree's
 * `google-payment` component (which knows how to turn what Google hands
 * back into a Braintree nonce). They're deliberately kept separate — Google
 * controls the payment-sheet UX and device/browser eligibility; Braintree
 * only gets involved at the tokenization step.
 *
 * WHY isReadyToPay() EXISTS
 * ---------------------------
 * Not every browser/device can use Google Pay (it depends on whether the
 * browser has any payment methods saved with Google at all). Rather than
 * showing a button that fails when clicked, Google requires you to check
 * eligibility FIRST via isReadyToPay(), and only render the button if that
 * comes back true. This is why setup here has an extra step compared to
 * PayPal or Venmo — there's a real chance the button never appears at all,
 * and that's expected behavior, not a bug.
 *
 * A REAL LESSON LEARNED BUILDING THIS DEMO — WORTH KEEPING IN:
 * ----------------------------------------------------------------
 * isReadyToPay() requires `apiVersion` and `apiVersionMinor` as TOP-LEVEL
 * fields on the request object you pass it — separate from the (correctly
 * structured) `allowedPaymentMethods` array nested inside. Omitting them
 * produces an error that misleadingly claims allowedPaymentMethods itself
 * is invalid, even when it's perfectly well-formed. This is a genuinely
 * easy mistake to make and a good one to know about ahead of time.
 * ============================================================================
 */

Diagnostics.init('#diagnostics-panel');

let googlePaymentInstance = null;
let paymentsClient = null;

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

// This runs when the customer clicks Google's own button. loadPaymentData()
// is the call that actually opens Google's payment sheet — everything
// before it just builds the request describing what we're asking for.
function onGooglePayButtonClicked() {
  const amount = document.getElementById('order-amount').value;

  Diagnostics.log('pending', `Building payment data request for $${amount}...`);

  const paymentDataRequest = googlePaymentInstance.createPaymentDataRequest({
    transactionInfo: {
      currencyCode: 'USD',
      totalPriceStatus: 'FINAL',
      totalPrice: amount,
    },
  });

  Diagnostics.log('info', 'Payment data request built', paymentDataRequest);

  if (!paymentDataRequest.allowedPaymentMethods || paymentDataRequest.allowedPaymentMethods.length === 0) {
    Diagnostics.log('error', 'allowedPaymentMethods missing on click-time request — aborting before calling Google.');
    return;
  }

  CodePanel.goToClientStep('tokenize');

  // >>> STEP:tokenize
  paymentsClient.loadPaymentData(paymentDataRequest)
    .then((paymentData) => {
      Diagnostics.log('success', 'Google Pay sheet approved by buyer', paymentData);
      return googlePaymentInstance.parseResponse(paymentData);
    })
    .then((result) => {
      Diagnostics.log('success', 'Nonce created', result);
      return submitCheckout(result.nonce);
    })
    // <<< STEP:tokenize
    .catch((err) => {
      // Google throws a plain object ({statusCode, statusMessage}) when the
      // buyer closes the sheet or something else goes wrong — not a
      // standard Error instance, so don't rely on err.message existing.
      if (err.statusCode === 'CANCELED') {
        Diagnostics.log('info', 'Buyer closed the Google Pay sheet before completing');
      } else {
        Diagnostics.log('error', 'Google Pay flow failed', err);
        const resultBanner = document.getElementById('result-banner');
        resultBanner.textContent = 'Google Pay payment was not completed.';
        resultBanner.className = 'result-banner show error';
      }
    });
}

function renderGooglePayButton() {
  const container = document.getElementById('gpay-button-container');
  container.innerHTML = '';

  const button = paymentsClient.createButton({
    onClick: onGooglePayButtonClicked,
    buttonType: 'pay',
    buttonSizeMode: 'fill',
  });
  container.appendChild(button);

  Diagnostics.log('success', 'Google Pay button rendered');
}

// >>> STEP:setup
function setupGooglePay(clientToken) {
  const note = document.getElementById('gpay-note');
  note.textContent = 'Setting up Google Pay...';

  Diagnostics.log('pending', 'Creating Braintree client...');
  CodePanel.goToClientStep('setup');

  braintree.client.create({ authorization: clientToken }, (err, clientInstance) => {
    if (err) {
      Diagnostics.log('error', 'braintree.client.create() failed', { message: err.message });
      note.textContent = 'Setup failed — see diagnostics.';
      return;
    }
    Diagnostics.log('success', 'Braintree client created');

    braintree.googlePayment.create({
      client: clientInstance,
      googlePayVersion: 2,
    }, (gpErr, gpInstance) => {
      if (gpErr) {
        Diagnostics.log('error', 'googlePayment.create() failed', { message: gpErr.message });
        note.textContent = 'Setup failed — see diagnostics.';
        return;
      }

      googlePaymentInstance = gpInstance;
      Diagnostics.log('success', 'Google Payment instance created');

      // TEST environment works with any Google account and returns fake
      // card data — no registered merchant ID needed for sandbox testing.
      paymentsClient = new google.payments.api.PaymentsClient({ environment: 'TEST' });

      // createPaymentDataRequest() needs a transactionInfo object to fully
      // populate allowedPaymentMethods — even for the readiness check.
      // NOT_CURRENTLY_KNOWN is the correct totalPriceStatus for this case,
      // since we don't have a final amount yet at setup time.
      const readyRequest = gpInstance.createPaymentDataRequest();

      // Log the raw request itself — if allowedPaymentMethods comes back
      // empty/missing here, that points to Google Pay not being enabled
      // on this merchant account rather than a client-side code issue.
      Diagnostics.log('info', 'Raw createPaymentDataRequest() output', readyRequest);

      if (!readyRequest.allowedPaymentMethods || readyRequest.allowedPaymentMethods.length === 0) {
        Diagnostics.log('error', 'allowedPaymentMethods came back empty — Google Pay is likely not enabled on this Braintree merchant account (Processing settings), not a code issue.');
        note.textContent = 'Google Pay is not enabled on this merchant account — check Processing settings in the Braintree Control Panel.';
        return;
      }

      // isReadyToPay() requires apiVersion/apiVersionMinor as TOP-LEVEL
      // fields on this request object, separate from the full payment data
      // request — omitting them produces a misleading error that blames
      // allowedPaymentMethods even though allowedPaymentMethods itself is fine.
      paymentsClient.isReadyToPay({
        apiVersion: 2,
        apiVersionMinor: 0,
        allowedPaymentMethods: readyRequest.allowedPaymentMethods,
      })
        .then((response) => {
          Diagnostics.log('info', 'isReadyToPay() result', response);
          if (response.result) {
            note.textContent = 'Click below — this opens the real Google Pay sheet (sandbox/test cards).';
            renderGooglePayButton();
          } else {
            note.textContent = 'Google Pay is not available in this browser/environment.';
            Diagnostics.log('error', 'Browser is not ready to pay with Google Pay');
          }
        })
        .catch((readyErr) => {
          // Google's pay.js throws plain objects ({statusCode, statusMessage}),
          // not standard Error instances — log the whole thing, not .message.
          Diagnostics.log('error', 'isReadyToPay() failed', readyErr);
          note.textContent = 'Setup failed — see diagnostics.';
        });
    });
  });
}
// <<< STEP:setup

function resetGooglePayDemo() {
  googlePaymentInstance = null;
  paymentsClient = null;
  document.getElementById('gpay-button-container').innerHTML = '';
  document.getElementById('gpay-note').textContent = 'Waiting for client token...';

  document.getElementById('order-amount').value = '49.00';
  document.getElementById('order-desc').value = 'Demo order — Google Pay';
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
  onTokenReady: (clientToken) => setupGooglePay(clientToken),
  onClear: resetGooglePayDemo,
});
