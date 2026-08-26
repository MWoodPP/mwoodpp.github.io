/**
 * ============================================================================
 * CHECKOUT WITH VAULT — Card + 3D Secure
 * ============================================================================
 * THIS PAGE IS THE INTERSECTION OF TWO DEMOS YOU'VE ALREADY SEEN:
 * ---------------------------------------------------------------------------
 *   - "One Time Payment → Card + 3DS": tokenize() → verifyCard() → upgraded
 *     nonce → /api/checkout. Identical here.
 *   - "Checkout with Vault → Card": one extra boolean, `saveInVault`, that
 *     becomes `options.storeInVaultOnSuccess` server-side.
 *
 * Combine them and nothing new happens — the 3DS-upgraded nonce goes into
 * the exact same /api/checkout call as the non-3DS vault demo, just with a
 * different nonce. server.js needed zero changes for 3DS on its own, and
 * needs zero additional changes to combine it with vaulting either.
 *
 * WHY THIS COMBINATION MATTERS IN PRACTICE (worth saying out loud to a
 * merchant): this is the "establish SCA on the first transaction of a
 * recurring relationship" pattern from Braintree's own applying-3DS guide —
 * challenge the cardholder now, on a real purchase, and the resulting
 * vaulted payment method carries that authentication forward. Subsequent
 * charges against this same vaulted card (e.g. from Vault → Charge Vaulted)
 * are then considered merchant-initiated and outside PSD2's SCA scope,
 * rather than needing a fresh 3DS challenge every time.
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

// 3DS-specific field names (givenName/surname, ASCII-only) — deliberately
// distinct from getCustomerDetails() above. See the One Time → Card + 3DS
// demo's app.js header comment for why this split exists.
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
    collectDeviceData: true,
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
  const saveInVault = document.getElementById('save-vault-checkbox').checked;
  const resultBanner = document.getElementById('result-banner');
  const vaultResult = document.getElementById('vault-result');
  resultBanner.className = 'result-banner';
  vaultResult.className = 'vault-result';

  Diagnostics.log('pending', `Submitting transaction.sale() for $${amount}${saveInVault ? ' (storeInVaultOnSuccess: true)' : ''} with 3DS-upgraded nonce...`);
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
      saveInVault,
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
        const shifted = threeDSecureInfo?.liabilityShifted;
        Diagnostics.log('success', `Transaction ${data.transaction.status}`, data.raw);
        resultBanner.textContent = `✅ Payment successful — Transaction ID: ${data.transaction.id} (${data.transaction.status}). Liability shifted: ${shifted}`;
        resultBanner.classList.add('show', 'success');

        if (saveInVault && data.transaction.customer && data.transaction.paymentMethodToken) {
          Diagnostics.log('success', 'Payment method vaulted alongside this purchase (with 3DS on file)', {
            customerId: data.transaction.customer.id,
            paymentMethodToken: data.transaction.paymentMethodToken,
          });
          vaultResult.innerHTML = `💾 Vaulted for future use — Customer ID: <code>${data.transaction.customer.id}</code> Payment Method Token: <code>${data.transaction.paymentMethodToken}</code><br>This 3DS authentication travels with the vaulted card. Charge it again from <a href="/demos/vault/charge/">Vault → Charge Vaulted</a>.`;
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

async function handleSubmit() {
  const submitBtn = document.getElementById('submit-btn');
  const resultBanner = document.getElementById('result-banner');
  const vaultResult = document.getElementById('vault-result');
  resultBanner.className = 'result-banner';
  vaultResult.className = 'vault-result';

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
      Diagnostics.log('error', 'Tokenization failed', { message: err.message });
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Payment';
      return;
    }

    Diagnostics.log('success', 'Nonce created (pre-3DS)', payload);
    // <<< STEP:tokenize
    submitBtn.textContent = 'Running 3D Secure...';

    const threeDSecureParameters = buildThreeDSecureParameters(payload.nonce, payload.details.bin);
    Diagnostics.log('pending', 'Calling threeDSecure.verifyCard()...', threeDSecureParameters);
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
  document.getElementById('order-desc').value = 'Demo order — Checkout with Vault (Card + 3DS)';
  document.getElementById('cust-first-name').value = 'Jane';
  document.getElementById('cust-last-name').value = 'Doe';
  document.getElementById('cust-email').value = 'jane.doe@example.com';
  document.getElementById('cust-phone').value = '8101234567';
  document.getElementById('addr-street').value = '2211 N 1st St';
  document.getElementById('addr-city').value = 'San Jose';
  document.getElementById('addr-state').value = 'CA';
  document.getElementById('addr-zip').value = '95131';
  document.getElementById('addr-country').value = 'US';
  document.getElementById('save-vault-checkbox').checked = true;

  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submit Payment';

  const resultBanner = document.getElementById('result-banner');
  resultBanner.className = 'result-banner';
  resultBanner.textContent = '';

  const vaultResult = document.getElementById('vault-result');
  vaultResult.className = 'vault-result';
  vaultResult.innerHTML = '';
}

CodePanel.init({ clientPath: 'app.js' });

ConfigPanel.init({
  onTokenReady: (clientToken) => setupHostedFieldsAnd3DS(clientToken),
  onClear: resetDemo,
});

document.getElementById('submit-btn').addEventListener('click', handleSubmit);
