/**
 * ============================================================================
 * VAULT — Store Card + 3D Secure (No Purchase)
 * ============================================================================
 * WHY THIS PAGE EXISTS AS ITS OWN THING, NOT JUST "3DS ON THE VAULT PAGE":
 * ---------------------------------------------------------------------------
 * Braintree's own docs call this out directly: establishing SCA at
 * VERIFICATION time (not transaction time) is exactly for scenarios where
 * "the cardholder will not be present when the charge is issued, and the
 * amount isn't known when the payment method is stored" — metered billing,
 * usage-based invoicing at the end of a month, etc. This page is that
 * pattern: no purchase happens here, just an authenticated card on file.
 *
 * THE ONE THING THAT DOESN'T FOLLOW OBVIOUSLY FROM THE OTHER 3DS DEMOS:
 * verifyCard() still requires an `amount` field, even though nothing is
 * being charged. Passing '0.00' returns an HTTP 422 from Braintree — it's
 * not optional and it's not zero. In production you'd pass your best
 * estimate of the eventual maximum charge; this demo exposes that as an
 * explicit "Anticipated Future Charge" field rather than hardcoding a
 * number, so it's clear where it comes from and why it exists.
 *
 * EVERYTHING ELSE IS UNCHANGED: the 3DS-upgraded nonce goes into
 * /api/vault/store exactly like a plain (non-3DS) card nonce would —
 * server.js needed no changes for this either. The 3D Secure authentication
 * ID is automatically attached to the resulting vaulted payment method.
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

// 3DS-specific field names (givenName/surname, ASCII-only) — see the One
// Time → Card + 3DS demo's app.js header comment for why this differs from
// getCustomerDetails() above.
function buildThreeDSecureParameters(nonce, bin) {
  // NOTE: required, non-zero. See file header — this is the "anticipated
  // future charge" field, not an actual amount being billed right now.
  const amount = document.getElementById('anticipated-amount').value;
  const customer = getCustomerDetails();
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
    },
    collectDeviceData: true,
    onLookupComplete: function (data, next) {
      Diagnostics.log('info', '3DS lookup complete', data);
      next();
    },
  };
}

function submitVaultStore(nonce, threeDSecureInfo) {
  const customer = getCustomerDetails();
  const resultBanner = document.getElementById('result-banner');
  const vaultResult = document.getElementById('vault-result');
  resultBanner.className = 'result-banner';
  vaultResult.className = 'vault-result';

  Diagnostics.log('pending', 'Calling /api/vault/store — creating Customer + vaulting card with 3DS authentication on file...');
  CodePanel.goToClientStep('submit');

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
    .then((res) => {
      CodePanel.goToServerStep('vaultstore');
      return res.json();
    })
    .then((data) => {
      if (data.success) {
        const pm = (data.customer.paymentMethods || [])[0];
        const shifted = threeDSecureInfo?.liabilityShifted;
        Diagnostics.log('success', 'Customer created & card vaulted with 3DS authentication', data.raw);
        resultBanner.textContent = `✅ Stored successfully — no charge occurred. Liability shifted at storage time: ${shifted}`;
        resultBanner.classList.add('show', 'success');

        if (pm) {
          vaultResult.innerHTML = `💾 Customer ID: <code>${data.customer.id}</code> Payment Method Token: <code>${pm.token}</code><br>This 3DS authentication is attached at storage time — future charges via <a href="/demos/vault/charge/">Vault → Charge Vaulted</a> reference it as already-established SCA, not a fresh challenge.`;
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

function handleSubmit() {
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
  CodePanel.goToClientStep('tokenize');

  // >>> STEP:tokenize
  hostedFieldsInstance.tokenize((err, payload) => {
    if (err) {
      Diagnostics.log('error', 'Tokenization failed', { message: err.message });
      submitBtn.disabled = false;
      submitBtn.textContent = 'Store Payment Method (No Charge)';
      return;
    }

    Diagnostics.log('success', 'Nonce created (pre-3DS)', payload);
    // <<< STEP:tokenize
    submitBtn.textContent = 'Running 3D Secure...';

    const threeDSecureParameters = buildThreeDSecureParameters(payload.nonce, payload.details.bin);
    Diagnostics.log('pending', 'Calling threeDSecure.verifyCard() — establishing SCA at storage time...', threeDSecureParameters);
    CodePanel.goToClientStep('verify3ds');

    // >>> STEP:verify3ds
    threeDSecureInstance.verifyCard(threeDSecureParameters, (tdsErr, response) => {
      if (tdsErr) {
        Diagnostics.log('error', 'threeDSecure.verifyCard() failed', { code: tdsErr.code, message: tdsErr.message });
        submitBtn.disabled = false;
        submitBtn.textContent = 'Store Payment Method (No Charge)';
        return;
      }

      Diagnostics.log('success', '3DS verification complete', {
        liabilityShifted: response.liabilityShifted,
        liabilityShiftPossible: response.liabilityShiftPossible,
        threeDSecureAuthenticationId: response.threeDSecureInfo?.threeDSecureAuthenticationId,
      });
      // <<< STEP:verify3ds

      submitVaultStore(response.nonce, response).finally(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Store Payment Method (No Charge)';
      });
    });
  });
}

function setupHostedFieldsAnd3DS(clientToken) {
  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;

  Diagnostics.log('pending', 'Creating Braintree client...');
  CodePanel.goToClientStep('setup');

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

  document.getElementById('cust-first-name').value = 'Jane';
  document.getElementById('cust-last-name').value = 'Doe';
  document.getElementById('cust-email').value = 'jane.doe@example.com';
  document.getElementById('cust-phone').value = '8101234567';
  document.getElementById('anticipated-amount').value = '49.00';

  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Store Payment Method (No Charge)';

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
