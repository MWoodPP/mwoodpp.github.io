/**
 * ============================================================================
 * SHARED CODE PANEL — Live Code Walkthrough (+ Step-by-Step Mode)
 * ============================================================================
 * WHAT THIS DOES AND, IMPORTANTLY, WHAT IT DOESN'T:
 * ---------------------------------------------------------------------------
 * This panel shows the ACTUAL running app.js / server.js — fetched at
 * runtime, not a hardcoded copy pasted into this file. That's deliberate:
 * a copy would drift out of sync the moment either file gets edited. There
 * is exactly one source of truth for each file, and this panel just
 * displays it.
 *
 *   - app.js: already served as a static file at the demo's own URL, so a
 *     plain fetch() gets it.
 *   - server.js: is the actual running server, not something a browser can
 *     normally fetch. GET /api/_source/server.js (added specifically for
 *     this panel) reads it off disk and returns the raw text — reasonable
 *     here because this is an internal demo/teaching tool, not something
 *     you'd expose on a real production checkout.
 *
 * STEP MARKERS: each file has plain-comment markers like:
 *     // >>> STEP:tokenize
 *     ...code...
 *     // <<< STEP:tokenize
 * This module finds those pairs, records their line ranges, and leaves the
 * comments in the displayed code (they double as free section labels).
 * Highlighting a step later is just: set the <pre>'s data-line to that
 * range and re-run Prism, which re-draws its Line Highlight overlay.
 *
 * STEP-BY-STEP MODE (new):
 * A toggle, injected into the Code Panel's own header, that turns each
 * STEP-marker transition into a genuine pause — the flow doesn't just
 * highlight the next block of code, it actually halts execution (via an
 * awaited Promise) until someone clicks "Next." This is for live demos:
 * flip it on, walk someone through the flow one deliberate click at a
 * time; leave it off (the default) for normal fast testing, where
 * everything runs exactly as before.
 *
 * Two things make this possible without touching every page's HTML:
 *   1. The toggle + Next button are injected by THIS script at init time,
 *      anchored to elements (`.code-panel-header`, `#code-panel-filename`)
 *      that already exist identically on every page.
 *   2. Every page's app.js already calls `CodePanel.goToClientStep(...)` /
 *      `goToServerStep(...)` at each meaningful boundary — those call sites
 *      just need `await` in front of them (a mechanical change) for the
 *      pause to actually hold up the surrounding async function, rather
 *      than firing-and-forgetting the highlight the way it did before.
 *
 * USAGE (from a page's own app.js):
 *   CodePanel.init({ clientPath: 'app.js' });
 *   await CodePanel.goToClientStep('tokenize');   // now awaited — pauses if step mode is on
 *   await CodePanel.goToServerStep('checkout');   // same; also auto-switches to Server tab
 * ============================================================================
 */
const CodePanel = (() => {
  let clientSource = null;
  let serverSource = null;
  let clientSteps = {};
  let serverSteps = {};
  let currentView = 'client';

  // ---- Step-by-step mode state ----
  let stepModeEnabled = false;
  let pendingResolve = null;

  // Human-readable labels for the Next button, keyed by STEP marker id.
  // Falls back to the raw id (still readable) for anything not listed here,
  // so a future page's new STEP id never breaks this — it just shows the
  // literal id instead of prose.
  const STEP_LABELS = {
    setup: 'set up the Braintree client & payment method',
    tokenize: 'tokenize the payment method',
    submit: 'submit the nonce to the server',
    checkout: 'process the sale on the server',
    vaultstore: 'store the payment method (no charge)',
    vaultcharge: 'charge the vaulted payment method',
    achcharge: 'process the ACH charge on the server',
    payoutscredit: 'issue the payout on the server',
    verify3ds: 'run 3D Secure verification',
    merchantvalidation: 'validate the merchant with Apple',
    createorder: 'create the PayPal order',
    createbillingagreement: 'create the PayPal billing agreement',
  };

  function humanize(stepId) {
    return STEP_LABELS[stepId] || stepId;
  }

  function extractSteps(source) {
    const lines = source.split('\n');
    const steps = {};
    const openStack = [];
    lines.forEach((line, idx) => {
      const openMatch = line.match(/\/\/\s*>>>\s*STEP:(\w+)/);
      const closeMatch = line.match(/\/\/\s*<<<\s*STEP:(\w+)/);
      if (openMatch) {
        openStack.push({ id: openMatch[1], start: idx + 1 }); // Prism data-line is 1-indexed
      }
      if (closeMatch) {
        const opened = openStack.pop();
        if (opened && opened.id === closeMatch[1]) {
          steps[opened.id] = { start: opened.start, end: idx + 1 };
        }
      }
    });
    return steps;
  }

  function render(source, filename) {
    const container = document.getElementById('code-panel-content');
    if (!container) return;
    container.innerHTML = '<pre class="line-numbers"><code class="language-javascript"></code></pre>';
    const codeEl = container.querySelector('code');
    codeEl.textContent = source;
    if (window.Prism) Prism.highlightElement(codeEl);
    const label = document.getElementById('code-panel-filename');
    if (label) label.textContent = filename;
  }

  function highlightStep(view, stepId) {
    const steps = view === 'client' ? clientSteps : serverSteps;
    const step = steps[stepId];
    const container = document.getElementById('code-panel-content');
    const pre = container?.querySelector('pre');
    const codeEl = pre?.querySelector('code');
    if (!container || !pre || !codeEl) return;

    if (step) {
      pre.setAttribute('data-line', `${step.start}-${step.end}`);
    } else {
      pre.removeAttribute('data-line');
    }
    // Re-running highlightElement re-triggers Prism's Line Highlight plugin
    // (it hooks Prism's 'after-highlight' event and reads data-line fresh
    // each time), so this is the supported way to change the highlighted
    // range after the initial render — no direct plugin API call needed.
    if (window.Prism) Prism.highlightElement(codeEl);

    requestAnimationFrame(() => {
      const marker = pre.querySelector('.line-highlight');
      if (!marker) return;
      // Manual scrollTop math instead of marker.scrollIntoView(): scrollIntoView
      // is spec'd to scroll EVERY scrollable ancestor needed to bring the
      // element into view, which includes the outer page itself if the code
      // panel isn't already fully visible — exactly the "whole page jumps"
      // bug this replaces. Setting #code-panel-content's own scrollTop
      // directly guarantees only this one internal container ever scrolls.
      const targetTop = marker.offsetTop - (container.clientHeight / 2) + (marker.offsetHeight / 2);
      container.scrollTo({ top: Math.max(targetTop, 0), behavior: 'smooth' });
    });
  }

  async function loadClient(path) {
    try {
      const res = await fetch(path);
      if (!res.ok) {
        throw new Error(`Fetching ${path} returned HTTP ${res.status}`);
      }
      clientSource = await res.text();
      clientSteps = extractSteps(clientSource);
    } catch (err) {
      console.error('[CodePanel] Failed to load client source:', err);
      clientSource = `// Failed to load ${path}\n// ${err.message}\n//\n// Open the browser console for the full error — this usually means\n// either the file path is wrong, or the request was blocked.`;
      clientSteps = {};
    }
  }

  async function loadServer() {
    if (serverSource) return;
    try {
      const res = await fetch('/api/_source/server.js');
      if (!res.ok) {
        throw new Error(`Fetching /api/_source/server.js returned HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Server reported failure with no message');
      }
      serverSource = data.code;
      serverSteps = extractSteps(serverSource);
    } catch (err) {
      console.error('[CodePanel] Failed to load server source:', err);
      serverSource = `// Failed to load server.js\n// ${err.message}\n//\n// Open the browser console for the full error.`;
      serverSteps = {};
    }
  }

  function showClient() {
    currentView = 'client';
    render(clientSource || '// (still loading — if this never changes, check the browser console)', 'app.js — client');
    document.getElementById('code-tab-client')?.classList.add('active');
    document.getElementById('code-tab-server')?.classList.remove('active');
  }

  async function showServer() {
    await loadServer();
    currentView = 'server';
    render(serverSource, 'server.js — server');
    document.getElementById('code-tab-client')?.classList.remove('active');
    document.getElementById('code-tab-server')?.classList.add('active');
  }

  // Waits one animation frame — used after switching tabs / re-rendering so
  // Prism has actually painted before we try to highlight a range in it.
  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  // ---- Step-by-step mode: the actual pause mechanism ----

  function resolvePending() {
    const bar = document.getElementById('step-next-bar');
    if (bar) bar.style.display = 'none';
    if (pendingResolve) {
      const r = pendingResolve;
      pendingResolve = null;
      r();
    }
  }

  /**
   * Pauses (if step mode is on) until the user clicks "Next," showing
   * `label` on the button. Resolves immediately, with no visible change,
   * if step mode is off — so every call site can unconditionally
   * `await CodePanel.checkpoint(...)` without checking the mode itself.
   *
   * Exposed publicly (not just used internally by goToClientStep/
   * goToServerStep) so a page can add a checkpoint at a moment that has no
   * corresponding STEP marker to highlight — e.g. config-panel.js pauses
   * here right before handing a freshly-fetched client token to the page,
   * since that fetch happens in a different shared file with no STEP
   * block of its own.
   */
  async function checkpoint(label) {
    if (!stepModeEnabled) return;
    return new Promise((resolve) => {
      pendingResolve = resolve;
      const bar = document.getElementById('step-next-bar');
      const labelEl = document.getElementById('step-next-label');
      if (labelEl) labelEl.textContent = label;
      if (bar) bar.style.display = 'flex';
    });
  }

  async function goToClientStep(stepId) {
    if (currentView !== 'client') showClient();
    await nextFrame(); // let Prism finish the initial render before we re-highlight
    highlightStep('client', stepId);
    await checkpoint(humanize(stepId));
  }

  async function goToServerStep(stepId) {
    await showServer();
    await nextFrame();
    highlightStep('server', stepId);
    await checkpoint(humanize(stepId));
  }

  // ---- Step-by-step mode: UI injection (no per-page HTML changes needed) ----

  function injectStepModeStyles() {
    if (document.getElementById('step-mode-styles')) return;
    const style = document.createElement('style');
    style.id = 'step-mode-styles';
    style.textContent = `
      .step-mode-row {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        margin: -4px 0 8px;
        flex-shrink: 0;
      }
      .step-mode-row label {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        color: var(--color-text-muted, #6b7280);
        cursor: pointer;
        user-select: none;
      }
      .step-mode-row input[type="checkbox"] {
        width: 13px;
        height: 13px;
        cursor: pointer;
      }
      #step-next-bar {
        display: none;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        background: #fef6e7;
        border: 1px solid #f0dfb8;
        border-radius: 8px;
        padding: 8px 10px;
        margin-bottom: 8px;
        flex-shrink: 0;
      }
      #step-next-bar .step-next-hint {
        font-size: 11px;
        color: #7a5c17;
        line-height: 1.4;
      }
      #step-next-btn {
        background: var(--color-primary, #003087);
        color: white;
        border: none;
        border-radius: 6px;
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
        flex-shrink: 0;
      }
      #step-next-btn:hover {
        opacity: 0.9;
      }
    `;
    document.head.appendChild(style);
  }

  function injectStepModeUI() {
    if (document.getElementById('step-mode-toggle')) return; // already injected

    const header = document.querySelector('.code-panel-header');
    const filenameEl = document.getElementById('code-panel-filename');
    if (!header || !filenameEl) return; // page doesn't have a Code Panel — nothing to do

    injectStepModeStyles();

    const toggleRow = document.createElement('div');
    toggleRow.className = 'step-mode-row';
    toggleRow.innerHTML = `
      <label for="step-mode-toggle">
        <input type="checkbox" id="step-mode-toggle">
        Step-by-step
      </label>
    `;
    header.insertAdjacentElement('afterend', toggleRow);

    const nextBar = document.createElement('div');
    nextBar.id = 'step-next-bar';
    nextBar.innerHTML = `
      <span class="step-next-hint">Next: <span id="step-next-label"></span></span>
      <button id="step-next-btn" type="button">Next →</button>
    `;
    filenameEl.insertAdjacentElement('afterend', nextBar);

    document.getElementById('step-mode-toggle').addEventListener('change', (e) => {
      stepModeEnabled = e.target.checked;
      // If someone turns step mode OFF while a checkpoint is actively
      // paused, don't leave the flow stuck waiting for a Next click that
      // will never come — release it immediately.
      if (!stepModeEnabled) resolvePending();
    });

    document.getElementById('step-next-btn').addEventListener('click', () => {
      resolvePending();
    });
  }

  async function init({ clientPath }) {
    // showClient() always runs, even on failure — loadClient() catches its
    // own errors and falls back to a visible in-panel message rather than
    // throwing, so the panel is never silently blank with no explanation.
    await loadClient(clientPath);
    showClient();
    injectStepModeUI();

    document.getElementById('code-tab-client')?.addEventListener('click', showClient);
    document.getElementById('code-tab-server')?.addEventListener('click', showServer);
  }

  return {
    init,
    goToClientStep,
    goToServerStep,
    checkpoint,
    isStepModeEnabled: () => stepModeEnabled,
  };
})();
