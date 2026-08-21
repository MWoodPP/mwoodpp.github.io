/**
 * Shared diagnostics/response panel logic.
 *
 * This is the "show your work" piece of the demo — every real network call
 * and SDK callback across every payment method logs here, so a merchant or
 * SE watching the screen can see exactly what's happening under the hood at
 * each step, not just the final success/failure. Nothing here is Braintree-
 * specific; it's plain UI logging, but it's what makes the rest of this
 * suite feel like a real dev tool rather than a black-box demo.
 *
 * Every demo (card, paypal, venmo, ...) imports this so the log panel
 * looks and behaves identically regardless of payment method.
 *
 * Usage:
 *   Diagnostics.init('#diagnostics-panel');
 *   Diagnostics.log('info', 'Requesting client token...');
 *   Diagnostics.log('success', 'Client token received', response);
 *   Diagnostics.log('error', 'Transaction failed', errorPayload);
 */
const Diagnostics = (() => {
  let container = null;
  let entryCount = 0;

  function init(selector) {
    container = document.querySelector(selector);
    if (!container) {
      console.warn(`Diagnostics: no element found for selector "${selector}"`);
    }
  }

  function timestamp() {
    const d = new Date();
    return d.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  /**
   * type: 'info' | 'success' | 'error' | 'pending'
   * label: short human-readable line, e.g. "Client token requested"
   * payload: optional object — rendered as collapsible raw JSON
   */
  function log(type, label, payload) {
    if (!container) return;
    entryCount += 1;

    const entry = document.createElement('div');
    entry.className = `diag-entry diag-${type}`;

    const header = document.createElement('div');
    header.className = 'diag-entry-header';

    const icon = { info: 'ℹ️', success: '✅', error: '❌', pending: '⏳' }[type] || '•';

    header.innerHTML = `
      <span class="diag-icon">${icon}</span>
      <span class="diag-label">${label}</span>
      <span class="diag-time">${timestamp()}</span>
    `;
    entry.appendChild(header);

    if (payload !== undefined) {
      const toggle = document.createElement('button');
      toggle.className = 'diag-toggle';
      toggle.textContent = 'View raw';
      const pre = document.createElement('pre');
      pre.className = 'diag-payload';
      pre.style.display = 'none';
      pre.textContent = JSON.stringify(payload, null, 2);

      toggle.addEventListener('click', () => {
        const isHidden = pre.style.display === 'none';
        pre.style.display = isHidden ? 'block' : 'none';
        toggle.textContent = isHidden ? 'Hide raw' : 'View raw';
      });

      entry.appendChild(toggle);
      entry.appendChild(pre);
    }

    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
    return entryCount;
  }

  function clear() {
    if (container) container.innerHTML = '';
    entryCount = 0;
  }

  return { init, log, clear };
})();
