// --- Injected into the page. Must be self-contained (no closures over
// background.js variables) since chrome.scripting.executeScript serializes
// these and re-runs them inside the target page. ---

function pagegrabPrepare() {
  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function findScrollContainer() {
    const doc = document.scrollingElement || document.documentElement;
    if (doc.scrollHeight - doc.clientHeight > 10) {
      return { el: doc, isWindow: true };
    }
    // The document itself doesn't scroll - look for an inner container that
    // does (common in app-shell layouts with a fixed header/sidebar and a
    // separately-scrolling main content area, e.g. Canvas LMS).
    let best = null;
    let bestScore = 0;
    for (const el of document.querySelectorAll('body *')) {
      const style = getComputedStyle(el);
      if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue;
      const delta = el.scrollHeight - el.clientHeight;
      if (delta < 20) continue;
      if (el.clientHeight < window.innerHeight * 0.4) continue;
      if (el.clientWidth < window.innerWidth * 0.3) continue;
      if (delta > bestScore) {
        bestScore = delta;
        best = el;
      }
    }
    return best ? { el: best, isWindow: false } : { el: doc, isWindow: true };
  }

  const { el, isWindow } = findScrollContainer();

  // Fixed/sticky chrome (headers, sidebars) is pinned to the viewport, so a
  // scroll-and-stitch capture would otherwise re-capture it in every tile.
  // Hide it for the duration of the capture instead.
  const hidden = [];
  document.querySelectorAll('body *').forEach((node) => {
    if (node === el || el.contains(node)) return;
    const style = getComputedStyle(node);
    if ((style.position === 'fixed' || style.position === 'sticky') && isVisible(node)) {
      hidden.push([node, node.style.visibility]);
      node.style.visibility = 'hidden';
    }
  });

  const originalScroll = isWindow ? window.scrollY : el.scrollTop;
  window.__pagegrab = { el, isWindow, hidden, originalScroll };

  // chrome.tabs.captureVisibleTab always screenshots the whole browser
  // viewport, not just this container - so its on-screen rectangle is
  // needed to crop each tile down to just the scrolling content later.
  // Assumes the container's position doesn't change while scrolling it,
  // which holds for the fixed-header/sidebar app-shell layouts this exists
  // to handle.
  const rect = isWindow
    ? { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight }
    : (() => {
        const r = el.getBoundingClientRect();
        return { top: r.top, left: r.left, width: r.width, height: r.height };
      })();

  return {
    totalHeight: el.scrollHeight,
    rect,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

function pagegrabScrollTo(y) {
  const state = window.__pagegrab;
  if (!state) return;
  if (state.isWindow) window.scrollTo(0, y);
  else state.el.scrollTop = y;
}

function pagegrabRestore() {
  const state = window.__pagegrab;
  if (!state) return;
  state.hidden.forEach(([node, orig]) => {
    node.style.visibility = orig;
  });
  if (state.isWindow) window.scrollTo(0, state.originalScroll);
  else state.el.scrollTop = state.originalScroll;
  delete window.__pagegrab;
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

async function captureFullPage(tab) {
  const metrics = await execInTab(tab.id, pagegrabPrepare);
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

async function handleCapture(tab) {
  if (!tab.id || !isCapturableUrl(tab.url)) {
    flashBadge(tab.id, '!', '#d32f2f');
    return;
  }

  chrome.action.setBadgeText({ tabId: tab.id, text: '...' });
  chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#3b82f6' });

  try {
    const dataUrl = await captureFullPage(tab);
    await chrome.downloads.download({
      url: dataUrl,
      filename: `pagegrab-${Date.now()}.png`,
      saveAs: false,
    });
    flashBadge(tab.id, '✓', '#22c55e');
  } catch (err) {
    console.error('PageGrab capture failed:', err);
    flashBadge(tab.id, 'ERR', '#d32f2f');
  }
}

chrome.action.onClicked.addListener(handleCapture);

// Exposed for testing: drives the exact same capture path without
// simulating a real toolbar click.
self.__pagegrabCaptureFullPage = captureFullPage;
