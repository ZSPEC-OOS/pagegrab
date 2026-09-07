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

// Auto-detect, scoped to a single frame: find the scrollable descendant
// hiding the most content in *this* document. Runs in every frame (see
// execAllFrames) since a page's real scroll pane is often inside an
// <iframe> - e.g. Canvas SpeedGrader's submission preview - and a
// same-frame-only scan would never see it. Caches the winning element on
// window so a later call in the same frame can reuse the exact same node.
function pagegrabScanScrollable() {
  let target = null;
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

  // A nested frame's own document can scroll as a whole, with no wrapping
  // overflow:auto div at all - e.g. Canvas SpeedGrader's submission iframe.
  // The top frame's own document scroll is deliberately not offered here
  // since 'page' mode already covers that case.
  if (window !== window.top) {
    const se = document.scrollingElement || document.documentElement;
    const selfOverflow = se.scrollHeight - se.clientHeight;
    if (selfOverflow > 2 && selfOverflow > maxOverflow) {
      maxOverflow = selfOverflow;
      target = se;
    }
  }

  if (!target) return null;
  window.__pagegrabAutoTarget = target;
  return { overflowAmount: maxOverflow };
}

// Prepares the inner-scroll capture target *within whichever frame this
// runs in* - either the element the user explicitly picked, or the one
// pagegrabScanScrollable already cached in this frame. Translates the
// target's rect into top-page viewport coordinates by walking up through
// any enclosing <iframe> elements (same-origin only), since
// chrome.tabs.captureVisibleTab always shoots the whole composited tab and
// the crop math in offscreen.js expects top-page coordinates regardless of
// which frame the content actually lives in.
function pagegrabPrepareInnerTarget(usePicked) {
  const restoreFixed = [];
  document.querySelectorAll('body *').forEach((el) => {
    const style = getComputedStyle(el);
    if (style.position !== 'fixed' && style.position !== 'sticky') return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    restoreFixed.push([el, el.style.visibility]);
    el.style.visibility = 'hidden';
  });

  let target = usePicked ? window.__pagegrabPickedElement : window.__pagegrabAutoTarget;
  if (target && (!target.isConnected || target.scrollHeight - target.clientHeight <= 2)) {
    target = null;
  }

  if (!target) {
    restoreFixed.forEach(([el, vis]) => { el.style.visibility = vis; });
    return { error: 'no-inner-scroll' };
  }

  // A frame's own document/root as target (see pagegrabScanScrollable)
  // needs its viewport rect, not getBoundingClientRect() - the root
  // element's own box doesn't reliably report the full scrollable area.
  const isFrameRoot = target === (document.scrollingElement || document.documentElement);
  const r = isFrameRoot
    ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
    : target.getBoundingClientRect();
  let left = r.left;
  let top = r.top;
  let win = window;
  while (win !== win.top) {
    let frameEl;
    try {
      frameEl = win.frameElement;
    } catch (e) {
      break; // cross-origin ancestor - can't determine its offset
    }
    if (!frameEl) break;
    const fr = frameEl.getBoundingClientRect();
    left += fr.left;
    top += fr.top;
    win = win.parent;
  }

  window.__pagegrab = { mode: 'inner', target, restoreFixed, originalScroll: target.scrollTop };

  return {
    totalHeight: target.scrollHeight,
    rect: { top, left, width: r.width, height: r.height },
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

function pagegrabPickerCleanup() {
  if (window.__pagegrabPicking) window.__pagegrabPicking.cleanup();
}

// Interactive picker: hover highlights the nearest scrollable ancestor
// under the cursor, click confirms it as the inner-scroll capture target.
// Needed because "largest overflow" is ambiguous on pages with several
// independently-scrolling panes - the user points at the one that matters.
// Injected into every frame (see execAllFrames) so it also works inside
// same-origin iframes, whose own document never sees events dispatched to
// an ancestor frame's listeners.
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
    // No nested overflow:auto/scroll box under the cursor - if this is a
    // nested frame, its own document can be the scroll area itself, with
    // no wrapper div at all (e.g. Canvas SpeedGrader's submission iframe).
    // Not offered for the top frame since 'page' mode already covers that.
    if (window !== window.top) {
      const se = document.scrollingElement || document.documentElement;
      if (se.scrollHeight - se.clientHeight > 2) return se;
    }
    return null;
  }

  function onMove(e) {
    const el = findScrollable(e.target);
    if (!el) { overlay.style.display = 'none'; return; }
    // documentElement's own getBoundingClientRect() can report the full
    // scrollHeight rather than the viewport - use the viewport box instead
    // so the highlight doesn't look absurdly tall.
    const r = el === (document.scrollingElement || document.documentElement)
      ? { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight }
      : el.getBoundingClientRect();
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

async function execInTab(tabId, func, args = [], frameId = 0) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func, args });
  return result;
}

// Runs func in every frame of the tab (top + same-origin iframes) and
// returns the raw per-frame results, so the caller can compare candidates
// across frames (e.g. "which frame has the biggest scrollable pane").
// Frames the extension can't access (cross-origin) are simply absent from
// the result rather than failing the whole call.
async function execAllFrames(tabId, func, args = []) {
  try {
    return await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func, args });
  } catch (e) {
    return [];
  }
}

// Which frame (if any) holds the user's picked inner-scroll target, per
// tab. Kept in chrome.storage.session rather than an in-memory variable
// because the MV3 service worker can be evicted between the user picking
// an element and later clicking Capture - the picked DOM element itself
// survives fine on the page, but we'd otherwise forget which frame it's in.
const PICKED_FRAMES_KEY = 'pagegrabPickedFrames';

async function getPickedFrame(tabId) {
  const stored = await chrome.storage.session.get(PICKED_FRAMES_KEY);
  return stored[PICKED_FRAMES_KEY]?.[tabId];
}

async function setPickedFrame(tabId, frameId) {
  const stored = await chrome.storage.session.get(PICKED_FRAMES_KEY);
  const all = stored[PICKED_FRAMES_KEY] || {};
  all[tabId] = frameId;
  await chrome.storage.session.set({ [PICKED_FRAMES_KEY]: all });
}

async function clearPickedFrame(tabId) {
  const stored = await chrome.storage.session.get(PICKED_FRAMES_KEY);
  const all = stored[PICKED_FRAMES_KEY] || {};
  delete all[tabId];
  await chrome.storage.session.set({ [PICKED_FRAMES_KEY]: all });
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

// Resolves which frame holds the inner-scroll target and prepares it
// there: the user's pick if one exists and still applies, otherwise the
// best auto-detected candidate across every frame in the tab.
async function resolveInnerTarget(tab) {
  const pinnedFrame = await getPickedFrame(tab.id);
  if (pinnedFrame !== undefined) {
    try {
      const metrics = await execInTab(tab.id, pagegrabPrepareInnerTarget, [true], pinnedFrame);
      if (!metrics?.error) return { frameId: pinnedFrame, metrics };
    } catch (e) {
      // frame likely gone (navigation, closed iframe) - fall through to auto-detect
    }
    await clearPickedFrame(tab.id);
  }

  const scanResults = await execAllFrames(tab.id, pagegrabScanScrollable);
  let bestFrameId = null;
  let bestOverflow = 0;
  for (const entry of scanResults) {
    if (entry?.result?.overflowAmount > bestOverflow) {
      bestOverflow = entry.result.overflowAmount;
      bestFrameId = entry.frameId;
    }
  }
  if (bestFrameId === null) return null;

  const metrics = await execInTab(tab.id, pagegrabPrepareInnerTarget, [false], bestFrameId);
  if (metrics?.error) return null;
  return { frameId: bestFrameId, metrics };
}

async function captureFullPage(tab, mode = 'page') {
  let frameId = 0;
  let metrics;

  if (mode === 'inner') {
    const resolved = await resolveInnerTarget(tab);
    if (!resolved) throw new Error('No inner scrollable element found on this page.');
    ({ frameId, metrics } = resolved);
  } else {
    metrics = await execInTab(tab.id, pagegrabPrepare);
  }

  const { totalHeight, rect, devicePixelRatio } = metrics;
  const viewportHeight = rect.height;

  const shots = [];
  try {
    let y = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const targetY = Math.min(y, Math.max(0, totalHeight - viewportHeight));
      await execInTab(tab.id, pagegrabScrollTo, [targetY], frameId);
      await new Promise((r) => setTimeout(r, 250)); // let repaint/lazy content settle
      const dataUrl = await captureVisibleTabWithRetry(tab.windowId);
      shots.push({ y: targetY, dataUrl });
      if (targetY + viewportHeight >= totalHeight) break;
      y += viewportHeight;
    }
  } finally {
    await execInTab(tab.id, pagegrabRestore, [], frameId);
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
          await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: pagegrabPickerStart });
          sendResponse({ ok: true });
          break;
        case 'pick-status': {
          const frameId = await getPickedFrame(tab.id);
          if (frameId === undefined) { sendResponse({ ok: true, info: null }); break; }
          let info = null;
          try {
            info = await execInTab(tab.id, pagegrabCheckPick, [], frameId);
          } catch (e) {
            info = null;
          }
          if (!info) await clearPickedFrame(tab.id);
          sendResponse({ ok: true, info });
          break;
        }
        case 'pick-clear': {
          const frameId = await getPickedFrame(tab.id);
          if (frameId !== undefined) {
            try {
              await execInTab(tab.id, pagegrabClearPick, [], frameId);
            } catch (e) {
              // frame may already be gone - nothing to clean up there
            }
            await clearPickedFrame(tab.id);
          }
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
      }
    })();
    return true;
  }

  if (msg?.target === 'pagegrab-picker' && sender.tab?.id) {
    const tabId = sender.tab.id;
    if (msg.type === 'picked') {
      setPickedFrame(tabId, sender.frameId);
      flashBadge(tabId, '✓', '#22c55e');
    }
    if (msg.type === 'picked' || msg.type === 'cancelled') {
      // Stop any other frames still in picker mode (e.g. Esc pressed while
      // focus was in a different frame than the one that started picking).
      chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: pagegrabPickerCleanup }).catch(() => {});
    }
    return false;
  }

  return false;
});

// Exposed for testing: drives the exact same capture path without
// simulating a real toolbar click.
self.__pagegrabCaptureFullPage = captureFullPage;
