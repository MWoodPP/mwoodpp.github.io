/**
 * ============================================================================
 * ONE TIME PAYMENT — Card + 3D Secure
 * ============================================================================
 * WHERE THIS SLOTS IN, RELATIVE TO THE PLAIN "CARD" DEMO:
 * ---------------------------------------------------------------------------
 * Hosted Fields tokenize() still happens first, exactly like the plain Card
 * demo — nothing about that step changes. 3DS is an EXTRA step inserted
 * between "I have a nonce" and "I submit that nonce to my server":
 *
 *   Hosted Fields tokenize() → 3DS verifyCard() → NEW upgraded nonce → server
 *
 * The nonce you get back from verifyCard() is a *different* nonce than the
 * one Hosted Fields gave you — it's the same underlying card, but now
 * carrying the completed 3D Secure authentication result. That upgraded
 * nonce is what you send to /api/checkout, not the original one.
 *
 * THE PART WORTH CALLING OUT: server.js's /api/checkout NEEDED ZERO CHANGES
 * to support this. Compare that to ACH, where usBankAccountVerificationMethod
 * had to be threaded through as a separate request option, or Venmo, where
 * paymentMethodUsage had to be set correctly at instance-creation time. 3DS's
 * authentication result travels INSIDE the nonce itself — the server just
 * receives a nonce and calls transaction.sale() exactly like it always does.
 * There's no new option to get wrong on the server side.
 *
 * THE ONE GENUINE GOTCHA: 3DS's billingAddress object uses different field
 * names than the rest of this app. Everywhere else here uses firstName /
 * lastName. 3DS's verifyCard() wants givenName / surname instead — and per
 * Braintree's docs, they must be ASCII-printable or Cardinal's API throws a
 * validation error. See buildThreeDSecureParameters() below.
 * ============================================================================
 */

Diagnostics.init('#diagnostics-panel');

let hostedFieldsInstance = null;
let threeDSecureInstance = null;

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

// NOTE: 3DS-specific field names — NOT the same as getBillingAddress() above.
// givenName/surname (not firstName/lastName), and per Braintree's docs these
// must be ASCII-printable characters or Cardinal (the 3DS provider) throws a
// validation error. This is a deliberately separate function so this
// mismatch is visible rather than silently reusing the wrong keys.
function buildThreeDSecureParameters(nonce, bin) {
  const amount = document.getElementById('order-amount').value;
  const customer = getCustomerDetails();
  const billing = getBillingAddress();
  const phone = document.getElementById('cust-phone')?.value || '';

  return {
    amount,
    nonce,
    bin,
    email: customer.email,
    billingAddress: {
      givenName: customer.firstName,
      surname: customer.lastName,
      phoneNumber: phone,
      streetAddress: billing.streetAddress,
      locality: billing.locality,
      region: billing.region,
      postalCode: billing.postalCode,
      countryCodeAlpha2: billing.countryCodeAlpha2,
    },
    // Reduces lookup failures/challenge frequency per Braintree's docs —
    // opt-in, not required, but cheap to include.
    collectDeviceData: true,
    // REQUIRED callback — 3DS will not proceed without it, even if you don't
    // need to inspect the lookup data before continuing.
    onLookupComplete: function (data, next) {
      Diagnostics.log('info', '3DS lookup complete', data);
      next();
    },
  };
}

async function submitCheckout(nonce, threeDSecureInfo) {
  const amount = document.getElementById('order-amount').value;
  const customer = getCustomerDetails();
  const billingAddress = getBillingAddress();
  const resultBanner = document.getElementById('result-banner');
  resultBanner.className = 'result-banner';

  Diagnostics.log('pending', `Submitting transaction.sale() for $${amount} with 3DS-upgraded nonce...`);
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
        const shifted = threeDSecureInfo?.liabilityShifted;
        resultBanner.textContent = `✅ Payment successful — Transaction ID: ${data.transaction.id} (${data.transaction.status}). Liability shifted: ${shifted}`;
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

async function handleSubmit() {
  const submitBtn = document.getElementById('submit-btn');
  const resultBanner = document.getElementById('result-banner');
  resultBanner.className = 'result-banner';

  if (!hostedFieldsInstance || !threeDSecureInstance) {
    Diagnostics.log('error', 'Hosted Fields or 3D Secure not initialized yet');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Tokenizing...';

  Diagnostics.log('pending', 'Tokenizing card details...');
  await CodePanel.goToClientStep('tokenize');

  // >>> STEP:tokenize
  hostedFieldsInstance.tokenize(async (err, payload) => {
    if (err) {
      // The top-level error message ("Cannot tokenize invalid card
      // fields.") doesn't say WHICH field failed. getState() does — pull
      // it out here so the diagnostics log is actually actionable instead
      // of just repeating the generic message.
      if (err.code === 'HOSTED_FIELDS_FIELDS_EMPTY' || err.code === 'HOSTED_FIELDS_FIELDS_INVALID') {
        const state = hostedFieldsInstance.getState();
        const fieldIssues = Object.keys(state.fields).reduce((acc, key) => {
          const field = state.fields[key];
          if (field.isEmpty) acc[key] = 'empty';
          else if (!field.isValid) acc[key] = 'invalid';
          return acc;
        }, {});
        Diagnostics.log('error', 'Tokenization failed — field-level detail', { code: err.code, fieldIssues });
      } else {
        Diagnostics.log('error', 'Tokenization failed', { message: err.message });
      }
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Payment';
      return;
    }

    Diagnostics.log('success', 'Nonce created (pre-3DS)', payload);
    // <<< STEP:tokenize
    submitBtn.textContent = 'Running 3D Secure...';

    const threeDSecureParameters = buildThreeDSecureParameters(payload.nonce, payload.details.bin);
    Diagnostics.log('pending', 'Calling threeDSecure.verifyCard() — a challenge may appear if the card is enrolled...', threeDSecureParameters);
    await CodePanel.goToClientStep('verify3ds');

    // >>> STEP:verify3ds
    threeDSecureInstance.verifyCard(threeDSecureParameters, async (tdsErr, response) => {
      if (tdsErr) {
        Diagnostics.log('error', 'threeDSecure.verifyCard() failed', { code: tdsErr.code, message: tdsErr.message });
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Payment';
        return;
      }

      Diagnostics.log('success', '3DS verification complete', {
        liabilityShifted: response.liabilityShifted,
        liabilityShiftPossible: response.liabilityShiftPossible,
        threeDSecureAuthenticationId: response.threeDSecureInfo?.threeDSecureAuthenticationId,
      });
      // <<< STEP:verify3ds

      submitCheckout(response.nonce, response).finally(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Payment';
      });
    });
  });
}

async function setupHostedFieldsAnd3DS(clientToken) {
  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;

  Diagnostics.log('pending', 'Creating Braintree client...');
  await CodePanel.goToClientStep('setup');

  // >>> STEP:setup
  braintree.client.create({ authorization: clientToken }, (err, clientInstance) => {
    if (err) {
      Diagnostics.log('error', 'braintree.client.create() failed', { message: err.message });
      return;
    }
    Diagnostics.log('success', 'Braintree client created');

    braintree.hostedFields.create({
      client: clientInstance,
      styles: {
        input: { 'font-size': '14px', color: '#1a1a2e' },
      },
      fields: {
        number: { selector: '#hf-number', placeholder: '4000000000002503 (see 3DS test cards →)' },
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

      // version: 2 explicitly requested — version 1 is deprecated per
      // Braintree's docs, and omitting this entirely can silently fall back
      // to an older flow.
      braintree.threeDSecure.create({
        client: clientInstance,
        version: 2,
      }, (tdsErr, tdsInstance) => {
        if (tdsErr) {
          Diagnostics.log('error', 'threeDSecure.create() failed', { message: tdsErr.message });
          return;
        }
        threeDSecureInstance = tdsInstance;
        Diagnostics.log('success', '3D Secure instance created (version 2)');
        submitBtn.disabled = false;
      });
    });
  });
  // <<< STEP:setup
}

function resetDemo() {
  if (hostedFieldsInstance) {
    hostedFieldsInstance.teardown((err) => {
      if (err) {
        Diagnostics.log('error', 'Hosted Fields teardown failed', { message: err.message });
      }
      ['hf-number', 'hf-expiration', 'hf-cvv'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
      });
    });
    hostedFieldsInstance = null;
  }
  threeDSecureInstance = null;

  document.getElementById('order-amount').value = '49.00';
  document.getElementById('order-desc').value = 'Demo order — Card + 3DS';
  document.getElementById('cust-first-name').value = 'Jane';
  document.getElementById('cust-last-name').value = 'Doe';
  document.getElementById('cust-email').value = 'jane.doe@example.com';
  document.getElementById('cust-phone').value = '8101234567';
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
  onTokenReady: (clientToken) => setupHostedFieldsAnd3DS(clientToken),
  onClear: resetDemo,
});

document.getElementById('submit-btn').addEventListener('click', handleSubmit);
