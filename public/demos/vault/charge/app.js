/**
 * ============================================================================
 * VAULT — Charge Vaulted (no SDK, no tokenization, on this page at all)
 * ============================================================================
 * WHY THIS PAGE LOOKS SO DIFFERENT FROM EVERY OTHER DEMO:
 * -----------------------------------------------------------
 * Every other page in this suite includes braintree.client.create() and
 * some payment-method-specific SDK component, because every other page's
 * whole job is turning a fresh card/PayPal-login/etc. into a nonce. THIS
 * page has nothing to tokenize — the payment method was already tokenized
 * and vaulted earlier (via Vault → Store, or a "Checkout with Vault" flow),
 * possibly in a completely different browser session. So there's no
 * Braintree client SDK script tag here at all, and no client token needed
 * on the frontend either — this page is really just a UI for calling one
 * server endpoint: POST /api/vault/charge, with an existing PAYMENT METHOD
 * TOKEN (not a nonce) and an amount.
 *
 * This is the clearest illustration in this whole suite of the "server
 * holds the real credentials, browser holds nothing sensitive" split
 * described in server.js — here, the browser doesn't even need a client
 * token, because it isn't tokenizing anything.
 * ============================================================================
 */

Diagnostics.init('#diagnostics-panel');

let selectedToken = null;

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

function toggleEditCredentials() {
  const editing = document.getElementById('cfg-edit-toggle').checked;
  document.getElementById('cfg-credentials-fields').style.display = editing ? 'grid' : 'none';
}

function selectCustomer(entry, rowEl) {
  document.querySelectorAll('.vaulted-row').forEach((el) => el.classList.remove('selected'));
  rowEl.classList.add('selected');
  selectedToken = entry.paymentMethodToken;
  document.getElementById('selected-token').value = selectedToken || '(no payment method token on this record)';
  document.getElementById('charge-btn').disabled = !selectedToken;
  Diagnostics.log('info', 'Selected vaulted customer', entry);
}

function loadVaultedCustomers() {
  const listEl = document.getElementById('vaulted-list');
  listEl.innerHTML = '<p class="vaulted-empty">Loading...</p>';

  fetch('/api/vault/customers')
    .then((res) => res.json())
    .then((data) => {
      const customers = data.customers || [];
      Diagnostics.log('info', `Found ${customers.length} vaulted customer(s) from this server session`, customers);

      if (customers.length === 0) {
        listEl.innerHTML = '<p class="vaulted-empty">None yet — go store one via Vault → Store, or check "Save this payment method" on a Checkout with Vault page, then click Refresh.</p>';
        return;
      }

      listEl.innerHTML = '';
      customers.slice().reverse().forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'vaulted-row';
        row.innerHTML = `
          <div>
            <div><strong>${entry.label}</strong></div>
            <div class="meta">Customer: ${entry.customerId} · via ${entry.source} · ${new Date(entry.vaultedAt).toLocaleString()}</div>
          </div>
          <div class="meta">${entry.paymentMethodToken ? 'Select →' : 'No token'}</div>
        `;
        row.addEventListener('click', () => selectCustomer(entry, row));
        listEl.appendChild(row);
      });
    })
    .catch((err) => {
      Diagnostics.log('error', 'Failed to load vaulted customers', { message: err.message });
      listEl.innerHTML = '<p class="vaulted-empty">Failed to load — see diagnostics.</p>';
    });
}

async function handleCharge() {
  const chargeBtn = document.getElementById('charge-btn');
  const resultBanner = document.getElementById('result-banner');
  resultBanner.className = 'result-banner';

  if (!selectedToken) {
    Diagnostics.log('error', 'No payment method token selected');
    return;
  }

  const amount = document.getElementById('charge-amount').value;

  chargeBtn.disabled = true;
  chargeBtn.textContent = 'Charging...';

  Diagnostics.log('pending', `Calling /api/vault/charge for $${amount} against token ${selectedToken} — no card entry, no nonce, this is charging what's already on file...`);
  await CodePanel.goToClientStep('submit');

  // >>> STEP:submit
  fetch('/api/vault/charge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentMethodToken: selectedToken,
      amount,
      credentials: getCredentialOverrides(),
    }),
  })
  // <<< STEP:submit
    .then(async (res) => {
      await CodePanel.goToServerStep('vaultcharge');
      return res.json();
    })
    .then((data) => {
      if (data.success) {
        Diagnostics.log('success', `Transaction ${data.transaction.status}`, data.raw);
        resultBanner.textContent = `✅ Charged successfully — Transaction ID: ${data.transaction.id} (${data.transaction.status})`;
        resultBanner.classList.add('show', 'success');
      } else {
        Diagnostics.log('error', 'Transaction declined or failed', data.raw || data);
        resultBanner.textContent = `❌ Charge failed — ${data.message || data.error || 'see diagnostics'}`;
        resultBanner.classList.add('show', 'error');
      }
    })
    .catch((fetchErr) => {
      Diagnostics.log('error', 'Charge request failed', { message: fetchErr.message });
      resultBanner.textContent = `❌ Request failed — ${fetchErr.message}`;
      resultBanner.classList.add('show', 'error');
    })
    .finally(() => {
      chargeBtn.disabled = false;
      chargeBtn.textContent = 'Charge Now';
    });
}

function clearAll() {
  selectedToken = null;
  document.getElementById('charge-amount').value = '25.00';
  document.getElementById('selected-token').value = '';
  document.getElementById('charge-btn').disabled = true;
  document.querySelectorAll('.vaulted-row').forEach((el) => el.classList.remove('selected'));

  const editToggle = document.getElementById('cfg-edit-toggle');
  if (editToggle) {
    editToggle.checked = false;
    toggleEditCredentials();
  }
  ['cfg-merchant-id', 'cfg-public-key', 'cfg-private-key'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  const resultBanner = document.getElementById('result-banner');
  resultBanner.className = 'result-banner';
  resultBanner.textContent = '';

  Diagnostics.clear();
  Diagnostics.log('info', 'Cleared. Loading vaulted customers...');
  loadVaultedCustomers();
}

document.getElementById('cfg-edit-toggle')?.addEventListener('change', toggleEditCredentials);
document.getElementById('cfg-clear-btn')?.addEventListener('click', clearAll);
document.getElementById('refresh-btn')?.addEventListener('click', loadVaultedCustomers);
document.getElementById('charge-btn')?.addEventListener('click', handleCharge);

CodePanel.init({ clientPath: 'app.js' });

loadVaultedCustomers();
