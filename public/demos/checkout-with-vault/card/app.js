/**
 * ============================================================================
 * CHECKOUT WITH VAULT — Card
 * ============================================================================
 * HOW THIS DIFFERS FROM THE PLAIN "ONE TIME PAYMENT → CARD" DEMO:
 * ------------------------------------------------------------------
 * Almost nothing about the tokenization step changes — same Hosted Fields,
 * same tokenize() call, same nonce. The ENTIRE difference is one boolean
 * flag sent to the server alongside the nonce: `saveInVault`. On the server
 * (see server.js /api/checkout), that becomes:
 *
 *     saleRequest.options.storeInVaultOnSuccess = true;
 *
 * That's it. Braintree runs the sale exactly as normal, and — only if the
 * sale succeeds — also keeps the payment method on file afterward, attached
 * to a Customer record. If the checkbox below is unchecked, this page
 * behaves identically to the plain Card demo.
 *
 * WHY THIS MATTERS: this is the most common real-world vaulting pattern —
 * "buy something today, and also save my card for next time" — versus the
 * separate "Vault" group in this suite, which stores a payment method with
 * NO purchase happening at all (see /demos/vault/store/).
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

async function handleSubmit() {
  const submitBtn = document.getElementById('submit-btn');
  const resultBanner = document.getElementById('result-banner');
  const vaultResult = document.getElementById('vault-result');
  resultBanner.className = 'result-banner';
  vaultResult.className = 'vault-result';

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

    Diagnostics.log('success', 'Nonce created', payload);
    // <<< STEP:tokenize

    const amount = document.getElementById('order-amount').value;
    const customer = getCustomerDetails();
    const billingAddress = getBillingAddress();
    const saveInVault = document.getElementById('save-vault-checkbox').checked;

    Diagnostics.log('info', 'Customer & billing details attached to transaction', {
      customer,
      billingAddress,
      saveInVault,
    });

    Diagnostics.log('pending', `Submitting transaction.sale() for $${amount}${saveInVault ? ' (storeInVaultOnSuccess: true)' : ''}...`);
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
        saveInVault,
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

          if (saveInVault && data.transaction.customer && data.transaction.paymentMethodToken) {
            Diagnostics.log('success', 'Payment method vaulted alongside this purchase', {
              customerId: data.transaction.customer.id,
              paymentMethodToken: data.transaction.paymentMethodToken,
            });
            vaultResult.innerHTML = `💾 Vaulted for future use — Customer ID: <code>${data.transaction.customer.id}</code> Payment Method Token: <code>${data.transaction.paymentMethodToken}</code><br>You can charge this again later from the <a href="/demos/vault/charge/">Vault → Charge Vaulted</a> demo.`;
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
      })
      .finally(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Payment';
      });
  });
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

  document.getElementById('order-amount').value = '49.00';
  document.getElementById('order-desc').value = 'Demo order — Checkout with Vault (Card)';
  document.getElementById('cust-first-name').value = 'Jane';
  document.getElementById('cust-last-name').value = 'Doe';
  document.getElementById('cust-email').value = 'jane.doe@example.com';
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
  onTokenReady: (clientToken) => setupHostedFields(clientToken),
  onClear: resetDemo,
});

document.getElementById('submit-btn').addEventListener('click', handleSubmit);
