/**
 * ============================================================================
 * VAULT — Store a Payment Method (no charge)
 * ============================================================================
 * THE KEY THING THIS PAGE DEMONSTRATES: TOKENIZATION AND CHARGING ARE
 * COMPLETELY SEPARATE OPERATIONS.
 * ---------------------------------------------------------------------------
 * Every other demo in this suite ends with a transaction.sale() call. This
 * one doesn't call transaction.sale() at all — look at server.js's
 * /api/vault/store handler: it calls `gateway.customer.create()` with a
 * paymentMethodNonce attached, and that's it. No amount, no sale, no money
 * movement whatsoever.
 *
 * WHAT ACTUALLY HAPPENS ON SUBMIT:
 *   1. Hosted Fields tokenizes the card exactly like the "One Time Payment"
 *      Card demo — same mechanism, same PCI-scope benefit.
 *   2. Instead of sending that nonce to /api/checkout, we send it to
 *      /api/vault/store.
 *   3. The server creates a Customer record and, in the same call, converts
 *      the nonce into a PERMANENT payment method token attached to that
 *      customer — as opposed to a nonce, which is one-time-use and expires.
 *   4. You're handed back a Customer ID and Payment Method Token. Write
 *      those down (or just follow the link this page shows you) — that's
 *      what you'll use on the "Charge Vaulted" page, possibly minutes,
 *      days, or months from now, with this exact browser tab long closed.
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
  submitBtn.textContent = 'Storing...';

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

    Diagnostics.log('success', 'Nonce created', payload);
    // <<< STEP:tokenize

    const customer = getCustomerDetails();

    Diagnostics.log('pending', 'Calling /api/vault/store — creating Customer + vaulting payment method (no transaction.sale())...');
    CodePanel.goToClientStep('submit');

    // >>> STEP:submit
    fetch('/api/vault/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentMethodNonce: payload.nonce,
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
          Diagnostics.log('success', 'Customer created & payment method vaulted', data.raw);
          resultBanner.textContent = `✅ Stored successfully — no charge occurred.`;
          resultBanner.classList.add('show', 'success');

          if (pm) {
            vaultResult.innerHTML = `💾 Customer ID: <code>${data.customer.id}</code> Payment Method Token: <code>${pm.token}</code><br>Go to <a href="/demos/vault/charge/">Vault → Charge Vaulted</a> to run a real transaction against this stored method, any time from now.`;
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
        submitBtn.textContent = 'Store Payment Method (No Charge)';
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

  document.getElementById('cust-first-name').value = 'Jane';
  document.getElementById('cust-last-name').value = 'Doe';
  document.getElementById('cust-email').value = 'jane.doe@example.com';

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
  onTokenReady: (clientToken) => setupHostedFields(clientToken),
  onClear: resetDemo,
});

document.getElementById('submit-btn').addEventListener('click', handleSubmit);
