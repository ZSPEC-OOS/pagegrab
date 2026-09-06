import http from 'node:http';
import { WebSocketServer } from 'ws';
import puppeteer from 'puppeteer';

const PORT = process.env.PORT || 8080;
const AUTH_TOKEN = process.env.PAGEGRAB_TOKEN;

if (!AUTH_TOKEN) {
  console.error('Set PAGEGRAB_TOKEN before starting the server.');
  process.exit(1);
}

const VIEWPORT = { width: 1280, height: 800 };

let browser;
let page;
let cdp;

async function ensureBrowser() {
  if (browser && browser.connected) return;

  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  page = (await browser.pages())[0] ?? (await browser.newPage());
  await page.setViewport(VIEWPORT);
  cdp = await page.target().createCDPSession();
  await cdp.send('Page.enable');
}

async function fullPageScreenshotBase64() {
  const { cssContentSize } = await cdp.send('Page.getLayoutMetrics');
  const width = Math.ceil(cssContentSize.width);
  const height = Math.ceil(cssContentSize.height);
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  return data;
}

function isNavigableUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('pagegrab live-browser backend');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let authed = false;
  let screencasting = false;
  let frameHandler = null;

  const send = (payload) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  };

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!authed) {
      if (msg.type === 'auth' && msg.token === AUTH_TOKEN) {
        authed = true;
        send({ type: 'authed' });
      } else {
        send({ type: 'error', message: 'Unauthorized.' });
        ws.close();
      }
      return;
    }

    try {
      switch (msg.type) {
        case 'navigate': {
          if (!isNavigableUrl(msg.url)) {
            send({ type: 'error', message: 'Only http(s) URLs are allowed.' });
            break;
          }
          await ensureBrowser();
          await page.goto(msg.url, { waitUntil: 'load', timeout: 30000 });
          send({ type: 'navigated', url: page.url() });
          break;
        }

        case 'start-view': {
          await ensureBrowser();
          if (!screencasting) {
            screencasting = true;
            frameHandler = (frame) => {
              send({ type: 'frame', data: frame.data });
              cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
            };
            cdp.on('Page.screencastFrame', frameHandler);
            await cdp.send('Page.startScreencast', {
              format: 'jpeg',
              quality: 80,
              maxWidth: VIEWPORT.width,
              maxHeight: VIEWPORT.height,
            });
          }
          break;
        }

        case 'click': {
          if (!cdp) break;
          await cdp.send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: msg.x,
            y: msg.y,
            button: 'left',
            clickCount: 1,
          });
          await cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: msg.x,
            y: msg.y,
            button: 'left',
            clickCount: 1,
          });
          break;
        }

        case 'wheel': {
          if (!page) break;
          await page.mouse.wheel({ deltaX: msg.deltaX, deltaY: msg.deltaY });
          break;
        }

        case 'key': {
          if (!page) break;
          // Single printable characters get typed; everything else (Enter,
          // Backspace, Tab, arrows, Escape, ...) is treated as a named key.
          // Puppeteer's KeyInput names line up with KeyboardEvent.key for
          // these, so the client can forward `event.key` as-is.
          try {
            if (msg.key.length === 1) {
              await page.keyboard.type(msg.key);
            } else {
              await page.keyboard.press(msg.key);
            }
          } catch {
            // Unrecognized key name (e.g. a bare modifier) - ignore it
            // rather than dropping the connection over a keystroke.
          }
          break;
        }

        case 'capture': {
          if (!cdp) {
            send({ type: 'error', message: 'Nothing loaded yet.' });
            break;
          }
          const data = await fullPageScreenshotBase64();
          send({ type: 'capture', data });
          break;
        }

        default:
          send({ type: 'error', message: `Unknown message type: ${msg.type}` });
      }
    } catch (err) {
      send({ type: 'error', message: err.message });
    }
  });

  ws.on('close', () => {
    if (frameHandler && cdp) {
      cdp.off('Page.screencastFrame', frameHandler);
      cdp.send('Page.stopScreencast').catch(() => {});
    }
  });
});

server.listen(PORT, () => {
  console.log(`pagegrab server listening on :${PORT}`);
});
