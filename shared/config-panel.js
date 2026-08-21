/**
 * ============================================================================
 * SHARED CONFIG PANEL — Client Token + Credential Management
 * ============================================================================
 * This is the shell every payment-method demo shares. It's worth walking
 * through on its own with a merchant/SE before diving into any specific
 * payment method, because it's the part of the flow that's IDENTICAL no
 * matter which funding source someone ends up choosing.
 *
 * THE LIFECYCLE THIS FILE MANAGES:
 *
 *   1. On page load, we call the server for a client token (see server.js —
 *      POST /api/client-token). This is always the very first network call
 *      any Braintree integration makes.
 *
 *   2. That token gets handed to whichever payment-method component the
 *      current demo page needs (Hosted Fields, PayPal Checkout, Venmo,
 *      Google Pay) via the `onTokenReady` callback. Every one of those SDKs
 *      requires a client token to initialize — it's the credential that
 *      tells Braintree's client-side JS which merchant/environment it's
 *      talking to and what it's allowed to do.
 *
 *   3. "Generate New Token" exists to make step 1 repeatable on demand —
 *      useful for a demo, but also illustrative of a real production
 *      pattern: client tokens are meant to be short-lived and regenerated
 *      per checkout session, not cached indefinitely in the browser.
 *
 *   4. "Use custom credentials" lets you swap which Merchant ID/keys the
 *      SERVER uses to mint that token — handy for showing how the exact
 *      same frontend code works unmodified against a different merchant
 *      account, which is a common thing SEs need to demonstrate.
 *
 * Usage:
 *   ConfigPanel.init({
 *     onTokenReady: (clientToken) => { ...set up SDK with token... },
 *     onClear: () => { ...reset this demo's own payment-method state... },
 *   });
 * ============================================================================
 */
const ConfigPanel = (() => {
  let clientToken = null;
  let onTokenReady = null;
  let onClear = null;

  // Only sent to the server if the "use custom credentials" checkbox is on.
  // In a real integration this whole concept wouldn't exist — the server
  // would just always use its own hardcoded env-var credentials. This exists
  // purely so a demo can show the same client code working against multiple
  // merchant accounts without redeploying anything.
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

  // Calls the server's /api/client-token endpoint (see server.js). This is
  // the ONLY step in the entire checkout flow where the browser and server
  // talk to each other before a payment method has even been chosen — every
  // other network call in this demo suite happens either browser-to-Braintree
  // (tokenization) or browser-to-server (submitting the final nonce).
  async function generateToken() {
    const tokenDisplay = document.getElementById('cfg-token-display');
    const genBtn = document.getElementById('cfg-generate-btn');

    genBtn.disabled = true;
    genBtn.textContent = 'Generating...';
    tokenDisplay.textContent = '(requesting...)';

    if (window.Diagnostics) {
      Diagnostics.log('pending', 'Requesting new client token...');
    }

    try {
      // NOTE: absolute URL, not relative — this page is served from GitHub
      // Pages (mwoodpp.github.io) but the server with the private key still
      // runs locally. Cross-origin by design; see server.js's app.use(cors()).
      const res = await fetch('https://localhost:3000/api/client-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getCredentialOverrides()),
      });
      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to generate client token');
      }

      clientToken = data.clientToken;
      tokenDisplay.textContent = clientToken;

      if (window.Diagnostics) {
        Diagnostics.log('success', 'Client token received', data.raw);
      }

      if (onTokenReady) onTokenReady(clientToken);
    } catch (err) {
      tokenDisplay.textContent = '(error — see diagnostics)';
      if (window.Diagnostics) {
        Diagnostics.log('error', 'Client token generation failed', { message: err.message });
      }
    } finally {
      genBtn.disabled = false;
      genBtn.textContent = 'Generate New Token';
    }
  }

  function copyToken() {
    if (!clientToken) return;
    navigator.clipboard.writeText(clientToken);
    const btn = document.getElementById('cfg-copy-btn');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1200);
  }

  function toggleEditCredentials() {
    const editing = document.getElementById('cfg-edit-toggle').checked;
    document.getElementById('cfg-credentials-fields').style.display = editing ? 'grid' : 'none';
  }

  /**
   * Wipes the client token, resets the credential-override fields and
   * "use custom credentials" toggle, clears the diagnostics log, and calls
   * back into the current demo (via onClear) so it can reset its own
   * payment-method-specific state (Hosted Fields, PayPal buttons, etc.)
   * and any order-detail fields.
   *
   * Does NOT auto-generate a new token afterward — leaves the screen blank
   * until the person explicitly clicks "Generate New Token" again.
   */
  function clearAll() {
    clientToken = null;

    const tokenDisplay = document.getElementById('cfg-token-display');
    if (tokenDisplay) tokenDisplay.textContent = '(cleared)';

    const editToggle = document.getElementById('cfg-edit-toggle');
    if (editToggle) {
      editToggle.checked = false;
      toggleEditCredentials();
    }

    ['cfg-merchant-id', 'cfg-public-key', 'cfg-private-key'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const envSelect = document.getElementById('cfg-environment');
    if (envSelect) envSelect.value = 'sandbox';

    if (window.Diagnostics) {
      Diagnostics.clear();
      Diagnostics.log('info', 'Cleared — click "Generate New Token" to start a fresh session');
    }

    if (onClear) onClear();
  }

  function init(options = {}) {
    onTokenReady = options.onTokenReady || null;
    onClear = options.onClear || null;

    document.getElementById('cfg-generate-btn')?.addEventListener('click', generateToken);
    document.getElementById('cfg-copy-btn')?.addEventListener('click', copyToken);
    document.getElementById('cfg-edit-toggle')?.addEventListener('change', toggleEditCredentials);
    document.getElementById('cfg-clear-btn')?.addEventListener('click', clearAll);

    // Auto-generate a token on page load so the demo is immediately usable.
    generateToken();
  }

  function getClientToken() {
    return clientToken;
  }

  return { init, getClientToken, generateToken, clearAll };
})();
