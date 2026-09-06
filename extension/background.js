// --- Injected into the page. Must be self-contained (no closures over
// background.js variables) since chrome.scripting.executeScript serializes
// these and re-runs them inside the target page. ---

function pagegrabPrepare() {
  // Un-clip every genuinely-overflowing scrollable box (rich-text answer
  // editors, nested content panes, etc.) so its full content joins the
  // normal document flow instead of staying hidden behind its own
  // independent scrollbar. A single scroll-and-stitch pass only ever moves
  // the document/window - anything clipped inside a smaller nested
  // scroll container would otherwise never be revealed at all, which is
  // what was cutting off longer answers.
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

  // Now that nested boxes no longer clip anything, a single scroll of the
  // document/window covers the whole page. Viewport-fixed/sticky chrome
  // (headers, sidebars) would still get re-captured in every tile, so hide
  // it for the duration of the capture.
  const restoreFixed = [];
  document.querySelectorAll('body *').forEach((el) => {
    const style = getComputedStyle(el);
    if (style.position !== 'fixed' && style.position !== 'sticky') return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    restoreFixed.push([el, el.style.visibility]);
    el.style.visibility = 'hidden';
  });

  const doc = document.scrollingElement || document.documentElement;
  const originalScroll = window.scrollY;
  window.__pagegrab = { restoreOverflow, restoreFixed, originalScroll };

  return {
    totalHeight: doc.scrollHeight,
    rect: { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

function pagegrabScrollTo(y) {
  window.scrollTo(0, y);
}

function pagegrabRestore() {
  const state = window.__pagegrab;
  if (!state) return;
  state.restoreOverflow.forEach(([el, overflow, overflowY, maxHeight, height]) => {
    el.style.overflow = overflow;
    el.style.overflowY = overflowY;
    el.style.maxHeight = maxHeight;
    el.style.height = height;
  });
  state.restoreFixed.forEach(([el, vis]) => {
    el.style.visibility = vis;
  });
  window.scrollTo(0, state.originalScroll);
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
