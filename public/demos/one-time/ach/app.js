/**
 * ============================================================================
 * ACH DIRECT DEBIT DEMO — braintree.usBankAccount
 * ============================================================================
 * THIS IS NOT HOSTED FIELDS, EVEN THOUGH IT LOOKS SIMILAR AT FIRST GLANCE.
 * ---------------------------------------------------------------------------
 * The defining feature of Hosted Fields (see the Card demo) is that the
 * customer types directly into a Braintree-controlled IFRAME — your own
 * JavaScript never touches the raw card number. ACH does NOT work that way.
 *
 * Look at index.html: the routing number and account number fields are
 * plain, ordinary <input> elements, sitting in YOUR OWN DOM, exactly like
 * the Amount or City fields elsewhere on this page. There's no invisible
 * Braintree iframe here. `usBankAccountInstance.tokenize()` reads these
 * values directly out of your own inputs and sends them to Braintree in
 * one call — the bank details pass through your own JavaScript variables
 * momentarily before that happens, which is a meaningfully different trust
 * model than Hosted Fields, even though the end result (a nonce, not raw
 * sensitive data reaching your server) is similar.
 *
 * TWO OTHER REAL DIFFERENCES FROM EVERY CARD/WALLET DEMO IN THIS SUITE:
 *
 *   1. No authorize/capture split, no void. ACH only supports sale and
 *      refund. There's no "submitForSettlement" concept to toggle — every
 *      successful sale here settles as part of the same operation.
 *
 *   2. Verification is a real, separate concept that doesn't exist for
 *      cards. An ACH payment method isn't automatically "good to charge"
 *      just because it tokenized successfully — Braintree needs to confirm
 *      the customer actually owns that bank account. This demo uses
 *      NETWORK_CHECK, which verifies instantly using just the routing +
 *      account number (passed as an option on the sale call itself, in
 *      server.js's /api/ach/charge). Other verification methods
 *      (micro-deposits, independent/bank-login check) take longer and
 *      aren't demonstrated here.
 *
 * Also note: Braintree's ACH integration explicitly does not support
 * recurring billing — if that's the use case you need, ACH isn't a fit for
 * it today, regardless of vaulting.
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

// >>> STEP:setup
function setupUsBankAccount(clientToken) {
  Diagnostics.log('pending', 'Creating Braintree client...');
  CodePanel.goToClientStep('setup');

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

function handleSubmit() {
  const submitBtn = document.getElementById('submit-btn');
  const resultBanner = document.getElementById('result-banner');
  resultBanner.className = 'result-banner';

  if (!usBankAccountInstance) {
    Diagnostics.log('error', 'US Bank Account instance not initialized yet');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Processing...';

  // NOTE: keys here must match Braintree's GraphQL billingAddress field
  // names — locality/region/postalCode, NOT city/state/zipCode. The
  // Braintree Web SDK silently drops any key it doesn't recognize when
  // building the tokenize() payload rather than erroring client-side, so
  // getting this wrong doesn't fail here — it fails later, server-side,
  // with a GraphQL "Field 'city' has coerced Null value" error that's much
  // harder to trace back to this line.
  const bankDetails = {
    routingNumber: document.getElementById('ach-routing-number').value,
    accountNumber: document.getElementById('ach-account-number').value,
    accountType: document.getElementById('ach-account-type').value,
    ownershipType: document.getElementById('ach-ownership-type').value,
    firstName: document.getElementById('ach-first-name').value,
    lastName: document.getElementById('ach-last-name').value,
    billingAddress: {
      streetAddress: document.getElementById('ach-street').value,
      locality: document.getElementById('ach-city').value,
      region: document.getElementById('ach-state').value,
      postalCode: document.getElementById('ach-zip').value,
    },
  };

  // This exact wording (or equivalent) is required — it's the actual
  // authorization text the customer is agreeing to, not decorative UI copy.
  const mandateText = 'By clicking ["Submit ACH Payment"], I authorize Braintree, a service of PayPal, to electronically debit my account and, if necessary, electronically credit my account to correct erroneous debits.';

  Diagnostics.log('pending', 'Tokenizing bank account details...', { bankDetails: { ...bankDetails, accountNumber: '••••' + bankDetails.accountNumber.slice(-4) } });
  CodePanel.goToClientStep('tokenize');

  // >>> STEP:tokenize
  usBankAccountInstance.tokenize({ bankDetails, mandateText }, (err, payload) => {
    if (err) {
      Diagnostics.log('error', 'Tokenization failed', { message: err.message });
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit ACH Payment';
      return;
    }

    // Note what's in this payload — bankDetails again, but this time
    // straight from Braintree's own response, confirming what got tokenized.
    Diagnostics.log('success', 'Nonce created', payload);
    // <<< STEP:tokenize

    const amount = document.getElementById('order-amount').value;

    Diagnostics.log('pending', `Submitting sale with NETWORK_CHECK verification for $${amount}...`);
    CodePanel.goToClientStep('submit');

    // >>> STEP:submit
    fetch('/api/ach/charge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentMethodNonce: payload.nonce,
        amount,
        credentials: getCredentialOverrides(),
      }),
    })
    // <<< STEP:submit
      .then((res) => {
        CodePanel.goToServerStep('achcharge');
        return res.json();
      })
      .then((data) => {
        if (data.success) {
          Diagnostics.log('success', `Transaction ${data.transaction.status}`, data.raw);
          resultBanner.textContent = `✅ ACH payment submitted — Transaction ID: ${data.transaction.id} (${data.transaction.status}). Note: ACH settlement takes several business days in the real world, even though the API call itself returns immediately.`;
          resultBanner.classList.add('show', 'success');
        } else {
          Diagnostics.log('error', 'Transaction declined or failed', data.raw || data);
          resultBanner.textContent = `❌ Payment failed — ${data.message || data.error || 'see diagnostics'}`;
          resultBanner.classList.add('show', 'error');
        }
      })
      .catch((fetchErr) => {
        Diagnostics.log('error', 'Charge request failed', { message: fetchErr.message });
        resultBanner.textContent = `❌ Request failed — ${fetchErr.message}`;
        resultBanner.classList.add('show', 'error');
      })
      .finally(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit ACH Payment';
      });
  });
}

function resetDemo() {
  usBankAccountInstance = null;

  document.getElementById('order-amount').value = '49.00';
  document.getElementById('order-desc').value = 'Demo order — ACH Direct Debit';
  document.getElementById('ach-first-name').value = 'Jane';
  document.getElementById('ach-last-name').value = 'Doe';
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
  submitBtn.textContent = 'Submit ACH Payment';

  const resultBanner = document.getElementById('result-banner');
  resultBanner.className = 'result-banner';
  resultBanner.textContent = '';
}

CodePanel.init({ clientPath: 'app.js' });

ConfigPanel.init({
  onTokenReady: (clientToken) => setupUsBankAccount(clientToken),
  onClear: resetDemo,
});

document.getElementById('submit-btn').addEventListener('click', handleSubmit);
document.getElementById('ach-mandate-checkbox').addEventListener('change', updateSubmitState);
