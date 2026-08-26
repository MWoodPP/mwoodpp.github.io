/**
 * ============================================================================
 * PAYOUTS — Detached (Blind) Credit
 * ============================================================================
 * WHY THIS PAGE LOOKS NOTHING LIKE ANY OTHER DEMO IN THIS SUITE:
 * ---------------------------------------------------------------------------
 * Every other page starts with some kind of client-side SDK component —
 * Hosted Fields, a PayPal button, a Venmo QR code — because every other page
 * is COLLECTING a new payment method from a person in front of a browser.
 *
 * This page has no SDK component at all. There's nothing to tokenize —
 * money is going OUT, to a payment method that was already vaulted on some
 * earlier visit to a Store: ___ page. So this page is really just a picker
 * (which vaulted customer/token?) and an amount, both going straight to the
 * server. No braintree.client.create(), no client token needed at all here.
 *
 * THE ACTUAL GATE, WHICH LIVES ENTIRELY SERVER-SIDE:
 * gateway.transaction.credit() will fail immediately with a processor/
 * gateway rejection unless "Credits Enabled" has been switched on for this
 * merchant account (an internal gateway admin toggle, not self-service) AND
 * the API user's role has "Create Credits without a Previous Transaction"
 * permission. If this page returns a rejection, that's almost certainly why
 * — see the reference panel for what that looks like.
 * ============================================================================
 */

Diagnostics.init('#diagnostics-panel');

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

function renderRecipientOptions(customers) {
  const select = document.getElementById('recipient-select');
  select.innerHTML = '';

  if (!customers.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(none yet — vault a payment method first)';
    select.appendChild(opt);
    select.disabled = true;
    return;
  }

  select.disabled = false;
  customers.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.paymentMethodToken || '';
    const typeLabel = c.paymentInstrumentType || 'unknown type';
    // Confirmed by direct testing: only CreditCard supports detached
    // credit. PayPal, Venmo (VenmoAccount), and ACH (UsBankAccount) all
    // reject with 91546 regardless of account config — flagging this in
    // the picker itself so it's visible before someone tries and waits on
    // a request that's guaranteed to fail.
    const isCard = typeLabel === 'CreditCard';
    const suffix = isCard ? '' : ' — ⚠ not supported (91546)';
    opt.textContent = `${c.label} — ${typeLabel} — ${c.paymentMethodToken || 'no token'}${suffix}`;
    if (!c.paymentMethodToken) opt.disabled = true;
    select.appendChild(opt);
  });
}

function loadRecipients() {
  const note = document.getElementById('recipients-note');
  note.textContent = 'Loading vaulted payment methods from this session...';

  Diagnostics.log('pending', 'Fetching /api/vault/customers...');

  return fetch('/api/vault/customers')
    .then((res) => res.json())
    .then((data) => {
      const customers = data.customers || [];
      Diagnostics.log('success', `Found ${customers.length} vaulted payment method(s) from this session`, customers);
      renderRecipientOptions(customers);
      note.textContent = customers.length
        ? `${customers.length} vaulted payment method(s) available — these come from any Store: ___ page you've used this session.`
        : 'No vaulted payment methods yet. Visit a Store: Card / PayPal / Venmo / ACH page first, then come back and click Refresh.';
    })
    .catch((err) => {
      Diagnostics.log('error', 'Failed to load vaulted customers', { message: err.message });
      note.textContent = 'Failed to load — see diagnostics.';
    });
}

async function handleSubmit() {
  const submitBtn = document.getElementById('submit-btn');
  const resultBanner = document.getElementById('result-banner');
  resultBanner.className = 'result-banner';

  const paymentMethodToken = document.getElementById('recipient-select').value;
  const amount = document.getElementById('payout-amount').value;

  if (!paymentMethodToken) {
    Diagnostics.log('error', 'No recipient selected');
    resultBanner.textContent = '❌ Pick a vaulted payment method first.';
    resultBanner.classList.add('show', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending...';

  Diagnostics.log('pending', `Calling /api/payouts/credit for $${amount} to token ${paymentMethodToken}...`);
  await CodePanel.goToClientStep('submit');

  // >>> STEP:submit
  fetch('/api/payouts/credit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentMethodToken,
      amount,
      credentials: getCredentialOverrides(),
    }),
  })
  // <<< STEP:submit
    .then(async (res) => {
      await CodePanel.goToServerStep('payoutscredit');
      return res.json();
    })
    .then((data) => {
      if (data.success) {
        Diagnostics.log('success', `Credit transaction ${data.transaction.status}`, data.raw);
        resultBanner.textContent = `✅ Credit issued — Transaction ID: ${data.transaction.id} (${data.transaction.status})`;
        resultBanner.classList.add('show', 'success');
      } else {
        // This is the expected outcome if Credits Enabled / the role
        // permission isn't actually set on whichever credentials this
        // request runs under — see the file header and reference panel.
        Diagnostics.log('error', 'Credit rejected', data.raw || data);
        resultBanner.textContent = `❌ Credit rejected — ${data.message || data.error || 'see diagnostics'}`;
        resultBanner.classList.add('show', 'error');
      }
    })
    .catch((fetchErr) => {
      Diagnostics.log('error', 'Payout request failed', { message: fetchErr.message });
      resultBanner.textContent = `❌ Request failed — ${fetchErr.message}`;
      resultBanner.classList.add('show', 'error');
    })
    .finally(() => {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Payout';
    });
}

function resetDemo() {
  document.getElementById('payout-amount').value = '20.00';
  const resultBanner = document.getElementById('result-banner');
  resultBanner.className = 'result-banner';
  resultBanner.textContent = '';
  loadRecipients();
}

CodePanel.init({ clientPath: 'app.js' });

// No client token / SDK needed on this page at all — see file header. Still
// hook into ConfigPanel so the credentials-override strip and Clear All
// button behave consistently with every other page in the suite.
ConfigPanel.init({
  onTokenReady: () => loadRecipients(),
  onClear: resetDemo,
});

document.getElementById('submit-btn').addEventListener('click', handleSubmit);
document.getElementById('refresh-recipients-btn').addEventListener('click', loadRecipients);
