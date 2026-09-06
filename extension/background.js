const CDP_VERSION = '1.3';

// Same technique as server/index.js's fullPageScreenshotBase64(), just run
// against the extension's own chrome.debugger session instead of an
// externally-attached CDP session - Page.getLayoutMetrics for the true
// content size, then Page.captureScreenshot with captureBeyondViewport so
// Chrome renders past the visible viewport in one pass.
async function captureFullPage(tabId) {
  await chrome.debugger.attach({ tabId }, CDP_VERSION);
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
    const { cssContentSize } = await chrome.debugger.sendCommand({ tabId }, 'Page.getLayoutMetrics');
    const width = Math.ceil(cssContentSize.width);
    const height = Math.ceil(cssContentSize.height);
    const result = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    return result.data;
  } finally {
    await chrome.debugger.detach({ tabId });
  }
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
    const base64 = await captureFullPage(tab.id);
    await chrome.downloads.download({
      url: `data:image/png;base64,${base64}`,
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

// Exposed so the exact capture path can be driven directly (e.g. from an
// automated test attached to this service worker) without simulating a
// real toolbar click.
self.__pagegrabCaptureFullPage = captureFullPage;
