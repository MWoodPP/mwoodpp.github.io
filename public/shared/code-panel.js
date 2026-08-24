/**
 * ============================================================================
 * SHARED CODE PANEL — Live Code Walkthrough
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
 * USAGE (from a page's own app.js):
 *   CodePanel.init({ clientPath: 'app.js', serverStepFile: 'server' });
 *   CodePanel.goToClientStep('tokenize');
 *   CodePanel.goToServerStep('checkout');   // auto-switches to Server tab
 * ============================================================================
 */
const CodePanel = (() => {
  let clientSource = null;
  let serverSource = null;
  let clientSteps = {};
  let serverSteps = {};
  let currentView = 'client';

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

  async function goToClientStep(stepId) {
    if (currentView !== 'client') showClient();
    // Give Prism a tick to finish the initial render before we re-highlight.
    setTimeout(() => highlightStep('client', stepId), 0);
  }

  async function goToServerStep(stepId) {
    await showServer();
    setTimeout(() => highlightStep('server', stepId), 30);
  }

  async function init({ clientPath }) {
    // showClient() always runs, even on failure — loadClient() catches its
    // own errors and falls back to a visible in-panel message rather than
    // throwing, so the panel is never silently blank with no explanation.
    await loadClient(clientPath);
    showClient();

    document.getElementById('code-tab-client')?.addEventListener('click', showClient);
    document.getElementById('code-tab-server')?.addEventListener('click', showServer);
  }

  return { init, goToClientStep, goToServerStep };
})();
