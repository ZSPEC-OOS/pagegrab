const webview = document.getElementById('view');
const urlInput = document.getElementById('url');
const backBtn = document.getElementById('back');
const forwardBtn = document.getElementById('forward');
const reloadBtn = document.getElementById('reload');
const goBtn = document.getElementById('go');
const captureBtn = document.getElementById('capture');
const statusEl = document.getElementById('status');

function normalizeUrl(raw) {
  const value = raw.trim();
  if (!value) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) return value;
  return `https://${value}`;
}

function navigate() {
  const url = normalizeUrl(urlInput.value);
  if (url) webview.loadURL(url);
}

goBtn.addEventListener('click', navigate);
urlInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') navigate();
});

backBtn.addEventListener('click', () => webview.canGoBack() && webview.goBack());
forwardBtn.addEventListener('click', () => webview.canGoForward() && webview.goForward());
reloadBtn.addEventListener('click', () => webview.reload());

webview.addEventListener('did-navigate', (event) => {
  urlInput.value = event.url;
});
webview.addEventListener('did-navigate-in-page', (event) => {
  urlInput.value = event.url;
});
webview.addEventListener('dom-ready', () => {
  urlInput.value = webview.getURL();
});

captureBtn.addEventListener('click', async () => {
  captureBtn.disabled = true;
  statusEl.textContent = 'Capturing full page…';
  try {
    const webContentsId = webview.getWebContentsId();
    const base64Png = await window.pagegrab.captureFullPage(webContentsId);
    const result = await window.pagegrab.savePng(base64Png);
    statusEl.textContent = result.saved
      ? `Saved: ${result.filePath}`
      : 'Save canceled.';
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  } finally {
    captureBtn.disabled = false;
  }
});
