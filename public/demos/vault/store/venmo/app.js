/**
 * ============================================================================
 * VAULT — Store Venmo (No Purchase)
 * ============================================================================
 * THE ONE LINE THAT MAKES THIS GENUINELY DIFFERENT FROM THE ONE-TIME VENMO
 * DEMO IN THIS SUITE:
 * ---------------------------------------------------------------------------
 *     braintree.venmo.create({ ..., paymentMethodUsage: 'multi_use' })
 *
 * The One Time Payment → Venmo demo uses paymentMethodUsage: 'single_use' —
 * correct there, since nothing is stored and the nonce is spent once against
 * a transaction.sale() and done. That same single_use payment method CANNOT
 * be vaulted — Braintree's docs are explicit that vaulting a Venmo account
 * requires 'multi_use'. Passing single_use here wouldn't throw an obvious
 * client-side error; it would just fail at the server-side vault step (or
 * silently produce a payment method that can't actually be reused), which
 * is a nastier bug to track down than an explicit error. This page is the
 * direct counterpart to Vault → Store: PayPal — same end result (a Customer
 * + a reusable payment method, no money moved), just reached through
 * Venmo's QR/app-switch flow instead of a card form or PayPal login.
 *
 * A SANDBOX-SPECIFIC LIMITATION WORTH KNOWING ABOUT:
 * Venmo does not support true end-to-end sandbox testing the way Card/ACH
 * do. The app-switch/QR flow will show a test merchant with Braintree's own
 * logo instead of "Braintree Demo Suite," and a successful scan+approve
 * always resolves to a fixed test user named "VenmoJoe" — there's no way to
 * simulate a *declined* Venmo authorization by scanning a "bad" QR code the
 * way you can type a decline-triggering card number or ACH account number.
 * Negative-path testing for Venmo happens server-side instead (fake nonces
 * against transaction.sale() directly), which doesn't fit this page's
 * interactive tokenize()-driven flow — see the Testing Notes panel.
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

function submitVaultStore(nonce, venmoUsername) {
  const customer = getCustomerDetails();
  const resultBanner = document.getElementById('result-banner');
  const vaultResult = document.getElementById('vault-result');
  resultBanner.className = 'result-banner';
  vaultResult.className = 'vault-result';

  Diagnostics.log('pending', 'Calling /api/vault/store — creating Customer + vaulting Venmo account (no transaction.sale())...');
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
        Diagnostics.log('success', 'Customer created & Venmo account vaulted', data.raw);
        resultBanner.textContent = `✅ Linked successfully — no charge occurred.${venmoUsername ? ` (@${venmoUsername})` : ''}`;
        resultBanner.classList.add('show', 'success');

        if (pm) {
          vaultResult.innerHTML = `💾 Customer ID: <code>${data.customer.id}</code> Payment Method Token: <code>${pm.token}</code><br>Go to <a href="/demos/vault/charge/">Vault → Charge Vaulted</a> to run a real transaction against this stored Venmo account, any time from now.`;
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

function handleVenmoClick() {
  if (!venmoInstance) {
    Diagnostics.log('error', 'Venmo instance not ready yet');
    return;
  }

  const btn = document.getElementById('venmo-btn');
  btn.disabled = true;
  btn.textContent = 'Waiting for scan...';

  Diagnostics.log('pending', 'tokenize() called — Braintree will display a QR code overlay to scan with the Venmo app.');
  CodePanel.goToClientStep('tokenize');

  // >>> STEP:tokenize
  venmoInstance.tokenize()
    .then((payload) => {
      Diagnostics.log('success', 'Nonce created', payload);
      const username = payload.details?.username;
      document.getElementById('venmo-note').textContent =
        `Linked ${username ? '@' + username : 'Venmo account'} — storing...`;
      return submitVaultStore(payload.nonce, username);
    })
    // <<< STEP:tokenize
    .catch((err) => {
      if (err.code === 'VENMO_CANCELED') {
        Diagnostics.log('info', 'Buyer canceled or closed the QR code overlay before scanning/approving', { message: err.message });
      } else {
        Diagnostics.log('error', 'Venmo tokenize() failed', { code: err.code, message: err.message });
      }
      const resultBanner = document.getElementById('result-banner');
      resultBanner.textContent = 'Venmo linking was not completed.';
      resultBanner.className = 'result-banner show error';
    })
    .finally(() => {
      btn.disabled = false;
      btn.textContent = 'Link Venmo Account';
    });
}

// >>> STEP:setup
function setupVenmo(clientToken) {
  const note = document.getElementById('venmo-note');
  const btn = document.getElementById('venmo-btn');
  note.textContent = 'Setting up Venmo...';

  Diagnostics.log('pending', 'Creating Braintree client...');
  CodePanel.goToClientStep('setup');

  braintree.client.create({ authorization: clientToken }, (err, clientInstance) => {
    if (err) {
      Diagnostics.log('error', 'braintree.client.create() failed', { message: err.message });
      note.textContent = 'Setup failed — see diagnostics.';
      return;
    }
    Diagnostics.log('success', 'Braintree client created');

    // paymentMethodUsage: 'multi_use' is the whole point of this page — see
    // file header. This is what makes the resulting payment method
    // reusable/vaultable, unlike the one-time demo's single_use.
    braintree.venmo.create({
      client: clientInstance,
      allowDesktop: true,
      paymentMethodUsage: 'multi_use',
    }, (vErr, instance) => {
      if (vErr) {
        Diagnostics.log('error', 'venmo.create() failed', { message: vErr.message });
        note.textContent = 'Setup failed — see diagnostics.';
        return;
      }

      venmoInstance = instance;
      Diagnostics.log('success', 'Venmo instance created (multi_use)', {
        isBrowserSupported: instance.isBrowserSupported(),
      });

      // If the page was reloaded after an app-switch redirect (mobile use
      // case), this picks up the in-progress result automatically.
      if (instance.hasTokenizationResult()) {
        Diagnostics.log('info', 'Detected an in-progress Venmo result — resuming...');
        instance.tokenize()
          .then((payload) => {
            Diagnostics.log('success', 'Nonce created (resumed)', payload);
            return submitVaultStore(payload.nonce, payload.details?.username);
          })
          .catch((resumeErr) => {
            Diagnostics.log('error', 'Failed to resume Venmo result', { message: resumeErr.message });
          });
      }

      note.textContent = 'Click below — a QR code will appear. Scan it with the Venmo app on your phone to link (no charge).';
      btn.disabled = false;
    });
  });
}
// <<< STEP:setup

function resetDemo() {
  venmoInstance = null;

  const btn = document.getElementById('venmo-btn');
  btn.disabled = true;
  btn.textContent = 'Link Venmo Account';

  document.getElementById('venmo-note').textContent = 'Waiting for client token...';

  document.getElementById('cust-first-name').value = 'Jane';
  document.getElementById('cust-last-name').value = 'Doe';
  document.getElementById('cust-email').value = 'jane.doe@example.com';

  const resultBanner = document.getElementById('result-banner');
  resultBanner.className = 'result-banner';
  resultBanner.textContent = '';

  const vaultResult = document.getElementById('vault-result');
  vaultResult.className = 'vault-result';
  vaultResult.innerHTML = '';
}

CodePanel.init({ clientPath: 'app.js' });

ConfigPanel.init({
  onTokenReady: (clientToken) => setupVenmo(clientToken),
  onClear: resetDemo,
});

document.getElementById('venmo-btn').addEventListener('click', handleVenmoClick);
