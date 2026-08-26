/**
 * ============================================================================
 * VAULT — Store ACH (No Purchase)
 * ============================================================================
 * WHY "VAULTED" DOESN'T AUTOMATICALLY MEAN "READY TO CHARGE" FOR ACH:
 * ---------------------------------------------------------------------------
 * This is the biggest conceptual difference from the Card version of this
 * page. With a card, a successful vault call means you can charge it,
 * full stop. With ACH, Braintree needs to confirm the customer actually
 * owns the bank account before it's transactable — and different
 * verification methods have very different timing:
 *
 *   - Network Check: verifies INSTANTLY using just the routing + account
 *     number, as part of this same vault call. Demonstrated here.
 *
 *   - Independent Check: skips Braintree's own verification entirely — YOU
 *     are asserting the account is already verified some other way (a
 *     third-party service, a manual process). This is marked "verified"
 *     immediately, but the responsibility for actually confirming account
 *     ownership sits with you, not Braintree. Also demonstrated here.
 *
 *   - Micro-transfers: NOT demonstrated on this page — it requires a
 *     multi-step flow (send small deposits, wait for the customer to see
 *     them in their real bank account, collect and confirm those amounts
 *     days later) that doesn't fit a single-page demo well. See Braintree's
 *     server-side docs for confirmMicroTransferAmounts if you need it.
 *
 * After vaulting, check `result.paymentMethod.verified` — this demo surfaces
 * that value directly so you can see whether the bank account this specific
 * verification method produced is actually ready to charge yet.
 * ============================================================================
 */

Diagnostics.init('#diagnostics-panel');

let usBankAccountInstance = null;

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

// >>> STEP:setup
async function setupUsBankAccount(clientToken) {
  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;

  Diagnostics.log('pending', 'Creating Braintree client...');
  await CodePanel.goToClientStep('setup');

  braintree.client.create({ authorization: clientToken }, (err, clientInstance) => {
    if (err) {
      Diagnostics.log('error', 'braintree.client.create() failed', { message: err.message });
      return;
    }
    Diagnostics.log('success', 'Braintree client created');

    braintree.usBankAccount.create({ client: clientInstance }, (uErr, instance) => {
      if (uErr) {
        Diagnostics.log('error', 'usBankAccount.create() failed', { message: uErr.message });
        return;
      }
      usBankAccountInstance = instance;
      Diagnostics.log('success', 'US Bank Account instance created — form enabled');
      updateSubmitState();
    });
  });
}
// <<< STEP:setup

function updateSubmitState() {
  const mandateChecked = document.getElementById('ach-mandate-checkbox').checked;
  document.getElementById('submit-btn').disabled = !usBankAccountInstance || !mandateChecked;
}

async function handleSubmit() {
  const submitBtn = document.getElementById('submit-btn');
  const resultBanner = document.getElementById('result-banner');
  const vaultResult = document.getElementById('vault-result');
  resultBanner.className = 'result-banner';
  vaultResult.className = 'vault-result';

  if (!usBankAccountInstance) {
    Diagnostics.log('error', 'US Bank Account instance not initialized yet');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Storing...';

  // NOTE: keys here are Braintree's GraphQL billingAddress field names —
  // `locality` / `region` / `postalCode`, NOT `city` / `state` / `zipCode`.
  // The Braintree Web SDK silently drops any key it doesn't recognize when
  // building the tokenize() payload rather than erroring client-side, so
  // using city/state/zipCode here would silently omit them and fail later
  // server-side with a GraphQL "Field 'city' has coerced Null value" error.
  const bankDetails = {
    routingNumber: document.getElementById('ach-routing-number').value,
    accountNumber: document.getElementById('ach-account-number').value,
    accountType: document.getElementById('ach-account-type').value,
    ownershipType: document.getElementById('ach-ownership-type').value,
    firstName: document.getElementById('cust-first-name').value,
    lastName: document.getElementById('cust-last-name').value,
    billingAddress: {
      streetAddress: document.getElementById('ach-street').value,
      locality: document.getElementById('ach-city').value,
      region: document.getElementById('ach-state').value,
      postalCode: document.getElementById('ach-zip').value,
    },
  };

  const mandateText = 'By clicking ["Store Bank Account"], I authorize Braintree, a service of PayPal, to electronically debit my account and, if necessary, electronically credit my account to correct erroneous debits.';

  Diagnostics.log('pending', 'Tokenizing bank account details...', { bankDetails: { ...bankDetails, accountNumber: '••••' + bankDetails.accountNumber.slice(-4) } });
  await CodePanel.goToClientStep('tokenize');

  // >>> STEP:tokenize
  usBankAccountInstance.tokenize({ bankDetails, mandateText }, async (err, payload) => {
    if (err) {
      Diagnostics.log('error', 'Tokenization failed', { message: err.message });
      submitBtn.disabled = false;
      submitBtn.textContent = 'Store Bank Account (No Charge)';
      return;
    }

    Diagnostics.log('success', 'Nonce created', payload);
    // <<< STEP:tokenize

    const customer = getCustomerDetails();
    const verificationMethod = document.getElementById('ach-verification-method').value;

    Diagnostics.log('pending', `Calling /api/vault/store with verification method: ${verificationMethod}...`);
    await CodePanel.goToClientStep('submit');

    // >>> STEP:submit
    fetch('/api/vault/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentMethodNonce: payload.nonce,
        customer,
        usBankAccountVerificationMethod: verificationMethod,
        credentials: getCredentialOverrides(),
      }),
    })
    // <<< STEP:submit
      .then(async (res) => {
        await CodePanel.goToServerStep('vaultstore');
        return res.json();
      })
      .then((data) => {
        if (data.success) {
          const pm = (data.customer.paymentMethods || [])[0];
          Diagnostics.log('success', 'Customer created & bank account vaulted', data.raw);

          // The whole point of this page's header comment — surfaced directly.
          const verified = pm ? pm.verified : undefined;
          Diagnostics.log(verified ? 'success' : 'info', `Verified status: ${verified}`, { verified });

          resultBanner.textContent = `✅ Stored successfully — no charge occurred. Verified: ${verified}`;
          resultBanner.classList.add('show', 'success');

          if (pm) {
            vaultResult.innerHTML = `💾 Customer ID: <code>${data.customer.id}</code> Payment Method Token: <code>${pm.token}</code> Verified: <code>${verified}</code><br>${verified ? 'Ready to charge now via' : 'Not yet verified — check status before attempting to charge via'} <a href="/demos/vault/charge/">Vault → Charge Vaulted</a>.`;
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
      })
      .finally(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Store Bank Account (No Charge)';
      });
  });
}

function resetDemo() {
  usBankAccountInstance = null;

  document.getElementById('cust-first-name').value = 'Jane';
  document.getElementById('cust-last-name').value = 'Doe';
  document.getElementById('cust-email').value = 'jane.doe@example.com';
  document.getElementById('ach-verification-method').value = 'network_check';
  document.getElementById('ach-account-type').value = 'checking';
  document.getElementById('ach-ownership-type').value = 'personal';
  document.getElementById('ach-routing-number').value = '011000015';
  document.getElementById('ach-account-number').value = '1000000000';
  document.getElementById('ach-street').value = '2211 N 1st St';
  document.getElementById('ach-city').value = 'San Jose';
  document.getElementById('ach-state').value = 'CA';
  document.getElementById('ach-zip').value = '95131';
  document.getElementById('ach-mandate-checkbox').checked = false;

  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Store Bank Account (No Charge)';

  const resultBanner = document.getElementById('result-banner');
  resultBanner.className = 'result-banner';
  resultBanner.textContent = '';

  const vaultResult = document.getElementById('vault-result');
  vaultResult.className = 'vault-result';
  vaultResult.innerHTML = '';
}

CodePanel.init({ clientPath: 'app.js' });

ConfigPanel.init({
  onTokenReady: (clientToken) => setupUsBankAccount(clientToken),
  onClear: resetDemo,
});

document.getElementById('submit-btn').addEventListener('click', handleSubmit);
document.getElementById('ach-mandate-checkbox').addEventListener('change', updateSubmitState);
