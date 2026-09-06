const { app, BrowserWindow, ipcMain, dialog, webContents } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Captures the full scrollable page (beyond the current viewport) of the
// given webContents using the Chrome DevTools Protocol, the same technique
// Puppeteer uses for `fullPage` screenshots.
ipcMain.handle('capture-fullpage', async (_event, webContentsId) => {
  const target = webContents.fromId(webContentsId);
  if (!target) throw new Error('Target page not found.');

  const dbg = target.debugger;
  const wasAttached = dbg.isAttached();

  try {
    if (!wasAttached) dbg.attach('1.3');

    await dbg.sendCommand('Page.enable');

    const { cssContentSize } = await dbg.sendCommand('Page.getLayoutMetrics');
    const width = Math.ceil(cssContentSize.width);
    const height = Math.ceil(cssContentSize.height);

    const { data } = await dbg.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });

    return data; // base64-encoded PNG
  } finally {
    if (!wasAttached) {
      try {
        dbg.detach();
      } catch {
        // already detached (e.g. page navigated/closed mid-capture)
      }
    }
  }
});

ipcMain.handle('save-png', async (_event, base64Data) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save full-page screenshot',
    defaultPath: `pagegrab-${Date.now()}.png`,
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
  });

  if (canceled || !filePath) return { saved: false };

  fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
  return { saved: true, filePath };
});
