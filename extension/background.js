// --- Injected into the page. Must be self-contained (no closures over
// background.js variables) since chrome.scripting.executeScript serializes
// these and re-runs them inside the target page. ---

function pagegrabPrepare(mode) {
  // Viewport-fixed/sticky chrome (headers, sidebars) would get re-captured
  // in every tile regardless of mode, so hide it for the duration of the
  // capture either way.
  const restoreFixed = [];
  document.querySelectorAll('body *').forEach((el) => {
    const style = getComputedStyle(el);
    if (style.position !== 'fixed' && style.position !== 'sticky') return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    restoreFixed.push([el, el.style.visibility]);
    el.style.visibility = 'hidden';
  });

  if (mode === 'inner') {
    // Prefer an element the user explicitly picked (see pagegrabPickerStart)
    // over guessing - pages with several scrollable panes are ambiguous for
    // a "largest overflow" heuristic alone. Fall back to that heuristic
    // when nothing was picked, or the pick no longer applies (removed from
    // the DOM, no longer overflowing).
    let target = window.__pagegrabPickedElement;
    if (target && (!target.isConnected || target.scrollHeight - target.clientHeight <= 2)) {
      target = null;
    }

    if (!target) {
      // Find the scrollable descendant hiding the most content - the
      // dominant nested pane (chat log, editor, answer box) rather than the
      // whole document. Slivers (scroll-hinting widgets a few px tall) are
      // excluded via the minimum size check.
      let maxOverflow = 0;
      document.querySelectorAll('body *').forEach((el) => {
        if (el === document.documentElement || el === document.body) return;
        const style = getComputedStyle(el);
        const scrollable =
          style.overflowY === 'auto' || style.overflowY === 'scroll' ||
          style.overflow === 'auto' || style.overflow === 'scroll';
        if (!scrollable) return;
        if (el.clientHeight < 40 || el.clientWidth < 40) return;
        const overflowAmount = el.scrollHeight - el.clientHeight;
        if (overflowAmount <= 2) return;
        if (overflowAmount > maxOverflow) {
          maxOverflow = overflowAmount;
          target = el;
        }
      });
    }

    if (!target) {
      restoreFixed.forEach(([el, vis]) => { el.style.visibility = vis; });
      return { error: 'no-inner-scroll' };
    }

    const r = target.getBoundingClientRect();
    window.__pagegrab = { mode: 'inner', target, restoreFixed, originalScroll: target.scrollTop };

    return {
      totalHeight: target.scrollHeight,
      rect: { top: r.top, left: r.left, width: r.width, height: r.height },
      devicePixelRatio: window.devicePixelRatio || 1,
    };
  }

  // mode 'page' (default): un-clip every genuinely-overflowing scrollable
  // box (rich-text answer editors, nested content panes, etc.) so its full
  // content joins the normal document flow instead of staying hidden
  // behind its own independent scrollbar. A single scroll-and-stitch pass
  // only ever moves the document/window - anything clipped inside a
  // smaller nested scroll container would otherwise never be revealed at
  // all, which is what was cutting off longer answers.
  const restoreOverflow = [];
  document.querySelectorAll('body *').forEach((el) => {
    if (el === document.documentElement || el === document.body) return;
    const style = getComputedStyle(el);
    const scrollable =
      style.overflowY === 'auto' || style.overflowY === 'scroll' ||
      style.overflow === 'auto' || style.overflow === 'scroll';
    if (!scrollable) return;
    if (el.scrollHeight - el.clientHeight <= 2) return;
    restoreOverflow.push([el, el.style.overflow, el.style.overflowY, el.style.maxHeight, el.style.height]);
    el.style.setProperty('overflow', 'visible', 'important');
    el.style.setProperty('max-height', 'none', 'important');
    el.style.setProperty('height', 'auto', 'important');
  });

  const doc = document.scrollingElement || document.documentElement;
  window.__pagegrab = { mode: 'page', restoreOverflow, restoreFixed, originalScroll: window.scrollY };

  return {
    totalHeight: doc.scrollHeight,
    rect: { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

function pagegrabScrollTo(y) {
  const state = window.__pagegrab;
  if (state && state.mode === 'inner') {
    state.target.scrollTop = y;
  } else {
    window.scrollTo(0, y);
  }
}

function pagegrabRestore() {
  const state = window.__pagegrab;
  if (!state) return;
  if (state.restoreOverflow) {
    state.restoreOverflow.forEach(([el, overflow, overflowY, maxHeight, height]) => {
      el.style.overflow = overflow;
      el.style.overflowY = overflowY;
      el.style.maxHeight = maxHeight;
      el.style.height = height;
    });
  }
  state.restoreFixed.forEach(([el, vis]) => {
    el.style.visibility = vis;
  });
  if (state.mode === 'inner') {
    state.target.scrollTop = state.originalScroll;
  } else {
    window.scrollTo(0, state.originalScroll);
  }
  delete window.__pagegrab;
}

function pagegrabCheckPick() {
  const el = window.__pagegrabPickedElement;
  if (!el || !el.isConnected) return null;
  if (el.scrollHeight - el.clientHeight <= 2) return null;
  return {
    tag: el.tagName.toLowerCase(),
    cls: (el.className || '').toString().trim().split(/\s+/)[0] || '',
    w: el.clientWidth,
    h: el.clientHeight,
  };
}

function pagegrabClearPick() {
  delete window.__pagegrabPickedElement;
}

// Interactive picker: hover highlights the nearest scrollable ancestor
// under the cursor, click confirms it as the inner-scroll capture target.
// Needed because "largest overflow" is ambiguous on pages with several
// independently-scrolling panes - the user points at the one that matters.
function pagegrabPickerStart() {
  if (window.__pagegrabPicking) window.__pagegrabPicking.cleanup();

  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #3b82f6;' +
    'background:rgba(59,130,246,0.15);display:none;box-sizing:border-box;';
  document.documentElement.appendChild(overlay);

  const banner = document.createElement('div');
  banner.textContent = 'PageGrab: click a scroll area to capture (Esc to cancel)';
  banner.style.cssText =
    'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
    'background:#111827;color:#fff;padding:6px 12px;border-radius:6px;' +
    'font:12px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.3);pointer-events:none;';
  document.documentElement.appendChild(banner);

  function findScrollable(node) {
    let el = node;
    while (el && el !== document.documentElement && el !== document.body) {
      const style = getComputedStyle(el);
      const scrollable =
        style.overflowY === 'auto' || style.overflowY === 'scroll' ||
        style.overflow === 'auto' || style.overflow === 'scroll';
      if (scrollable && el.clientHeight >= 40 && el.clientWidth >= 40 && el.scrollHeight - el.clientHeight > 2) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  function onMove(e) {
    const el = findScrollable(e.target);
    if (!el) { overlay.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.top = `${r.top}px`;
    overlay.style.left = `${r.left}px`;
    overlay.style.width = `${r.width}px`;
    overlay.style.height = `${r.height}px`;
  }

  function cleanup() {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    banner.remove();
    delete window.__pagegrabPicking;
  }

  function onClick(e) {
    const el = findScrollable(e.target);
    if (!el) return; // not over a valid target - let the click through, keep picking
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    window.__pagegrabPickedElement = el;
    overlay.style.borderColor = '#22c55e';
    overlay.style.background = 'rgba(34,197,94,0.25)';
    chrome.runtime.sendMessage({
      target: 'pagegrab-picker',
      type: 'picked',
      info: {
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().trim().split(/\s+/)[0] || '',
        w: el.clientWidth,
        h: el.clientHeight,
      },
    });
    setTimeout(cleanup, 300);
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    cleanup();
    chrome.runtime.sendMessage({ target: 'pagegrab-picker', type: 'cancelled' });
  }

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  window.__pagegrabPicking = { cleanup };
}

// --- Background service worker logic. ---

async function execInTab(tabId, func, args = []) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return result;
}

async function captureVisibleTabWithRetry(windowId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    } catch (err) {
      // chrome.tabs.captureVisibleTab is rate-limited (~2 calls/sec); back
      // off and retry rather than failing the whole capture over it.
      if (attempt === 2) throw err;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}

async function stitchTiles(shots, { totalHeight, rect, devicePixelRatio }) {
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_SCRAPING'],
      justification: 'Stitch captured viewport tiles into one full-page image via canvas.',
    });
  }

  const response = await chrome.runtime.sendMessage({
    target: 'pagegrab-offscreen',
    type: 'stitch',
    payload: { shots, totalHeight, rect, devicePixelRatio },
  });

  await chrome.offscreen.closeDocument();

  if (!response?.ok) throw new Error(response?.error ?? 'Stitching failed');
  return response.dataUrl;
}

async function captureFullPage(tab, mode = 'page') {
  const metrics = await execInTab(tab.id, pagegrabPrepare, [mode]);
  if (metrics?.error === 'no-inner-scroll') {
    throw new Error('No inner scrollable element found on this page.');
  }
  const { totalHeight, rect, devicePixelRatio } = metrics;
  const viewportHeight = rect.height;

  const shots = [];
  try {
    let y = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const targetY = Math.min(y, Math.max(0, totalHeight - viewportHeight));
      await execInTab(tab.id, pagegrabScrollTo, [targetY]);
      await new Promise((r) => setTimeout(r, 250)); // let repaint/lazy content settle
      const dataUrl = await captureVisibleTabWithRetry(tab.windowId);
      shots.push({ y: targetY, dataUrl });
      if (targetY + viewportHeight >= totalHeight) break;
      y += viewportHeight;
    }
  } finally {
    await execInTab(tab.id, pagegrabRestore);
  }

  return stitchTiles(shots, { totalHeight, rect, devicePixelRatio });
}

function isCapturableUrl(url) {
  return typeof url === 'string' && /^https?:\/\//.test(url);
}

function flashBadge(tabId, text, color) {
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color });
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), 2000);
}

async function handleCapture(tab, mode = 'page') {
  if (!tab.id || !isCapturableUrl(tab.url)) {
    flashBadge(tab.id, '!', '#d32f2f');
    return;
  }

  chrome.action.setBadgeText({ tabId: tab.id, text: '...' });
  chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#3b82f6' });

  try {
    const dataUrl = await captureFullPage(tab, mode);
    await chrome.downloads.download({
      url: dataUrl,
      filename: `pagegrab${mode === 'inner' ? '-inner' : ''}-${Date.now()}.png`,
      saveAs: false,
    });
    flashBadge(tab.id, '✓', '#22c55e');
  } catch (err) {
    console.error('PageGrab capture failed:', err);
    flashBadge(tab.id, 'ERR', '#d32f2f');
  }
}

// Popup's mode switch and picker drive capture (the toolbar action opens
// the popup instead of firing chrome.action.onClicked directly).
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'pagegrab-popup') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      switch (msg.type) {
        case 'capture':
          await handleCapture(tab, msg.mode);
          sendResponse({ ok: true });
          break;
        case 'pick-start':
          await execInTab(tab.id, pagegrabPickerStart);
          sendResponse({ ok: true });
          break;
        case 'pick-status':
          sendResponse({ ok: true, info: await execInTab(tab.id, pagegrabCheckPick) });
          break;
        case 'pick-clear':
          await execInTab(tab.id, pagegrabClearPick);
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
      }
    })();
    return true;
  }

  if (msg?.target === 'pagegrab-picker' && msg.type === 'picked' && sender.tab?.id) {
    flashBadge(sender.tab.id, '✓', '#22c55e');
    return false;
  }

  return false;
});

// Exposed for testing: drives the exact same capture path without
// simulating a real toolbar click.
self.__pagegrabCaptureFullPage = captureFullPage;
