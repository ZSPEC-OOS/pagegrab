# PageGrab

Three ways to capture a **full page** (the entire scrollable height, not just
what's visible) as a PNG:

1. **Browser extension** (`/extension` — recommended) — a toolbar button in
   your own browser. Click it on any tab; the full page downloads as a PNG.
   No server, no hosting, no cost, ever.
2. **Desktop app** (`/` — Electron) — a standalone window with an address
   bar, click Capture.
3. **Web app** (`/web` + `/server`) — a Vercel-hosted page showing a *live*
   view of a browser running on a small backend server; click into it to
   focus it, then click, scroll, and type as usual to navigate/interact,
   then capture. Useful if you specifically need a hosted URL you can reach
   from any device — otherwise the extension is simpler and free.

All three use the same underlying technique: the Chrome DevTools Protocol's
`Page.captureScreenshot` with `captureBeyondViewport: true`, clipped to the
page's full content size (`Page.getLayoutMetrics`) — the same approach
Puppeteer uses for `page.screenshot({ fullPage: true })`.

---

## 1. Browser extension (recommended)

No build step, no account, no cost. It uses `chrome.debugger` — the same
Chrome DevTools Protocol the other two versions use, just attached directly
to your own already-open tab instead of a remote one, which is why there's
no server involved at all.

**Install:**
1. Open `chrome://extensions` (or `edge://extensions` on Edge).
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked**, and select the `extension/` folder.

**Use:** open any page, click the PageGrab icon in the toolbar. A badge
shows `...` while it captures, then `✓` once the PNG has downloaded (or
`ERR` if something went wrong — check the extension's service worker
console via `chrome://extensions` → PageGrab → "service worker" for
details).

**Note:** Chrome shows a brief "PageGrab is debugging this browser" banner
while attached — that's Chrome's required, non-optional indicator for any
extension using the debugger API. It appears only for the ~1 second a
capture takes.

To publish it properly instead of loading it unpacked every time you
reinstall Chrome: the Chrome Web Store has a one-time $5 developer
registration fee; Firefox's Add-ons site is free.

---

## Why the web version needs two parts

A live, clickable browser session is a *persistent, stateful* process — it
has to stay running and connected between your clicks. Vercel's normal
serverless functions are short-lived request/response handlers, not built to
hold that kind of session open. So:

- **`/web`** is a static-ish Next.js page → deploys to **Vercel** as usual.
- **`/server`** is a small always-on Node process (headless Chromium +
  WebSocket) → deploys to a host built for long-running processes, e.g.
  **Fly.io**. The web page connects to it over WebSocket.

Nothing is stored server-side: each capture streams straight from the
backend to your browser, which saves it via a normal file download — same
as clicking a download link.

---

## 2. Desktop app (Electron)

```bash
npm install
npm start
```

Opens a window with an address bar and a **Capture Full Page** button. See
inline comments in `main.js` for how the capture works.

---

## 3. Web app (Vercel + Fly.io)

### Deploy the backend (`/server`) to Fly.io

Requires the [`flyctl` CLI](https://fly.io/docs/flyctl/install/), installed
and logged in on your machine (this is the one place a local install is
unavoidable — Fly.io needs it to build and push the container image).

```bash
cd server
fly launch --no-deploy   # creates the app, rename it when prompted
fly secrets set PAGEGRAB_TOKEN=$(openssl rand -hex 24)
fly deploy
```

Save the token `fly secrets set` generated above — it's what the web page
uses to authenticate. Note the app's hostname (`fly status` or the deploy
output), e.g. `pagegrab-server.fly.dev`; the web page will connect to
`wss://pagegrab-server.fly.dev`.

### Deploy the frontend (`/web`) to Vercel

No local install needed for this part:

1. Push this repo to GitHub (already done if you're reading this from the
   repo).
2. On [vercel.com](https://vercel.com): **Add New Project** → **Import Git
   Repository** → select this repo.
3. Set **Root Directory** to `web` in the import settings.
4. Deploy. Vercel builds it in the cloud.

### Using it

1. Open the deployed Vercel URL.
2. Enter the backend URL (`wss://your-app.fly.dev`) and the token from
   `fly secrets set` above. These are remembered in the browser's
   `localStorage` for next time.
3. Click **Connect** — you'll see a live view of the remote browser.
4. Type a URL in the address bar, click into the view to interact with the
   page (clicks are forwarded to the real browser).
5. Click **Capture Full Page** — the PNG downloads to your machine.

### Local development

```bash
cd server && npm install && PAGEGRAB_TOKEN=devtoken npm start
cd web && npm install && npm run dev
```

Then connect the web app to `ws://localhost:8080` with token `devtoken`.

### Security note

The backend will navigate to, and screenshot, whatever URL it's told to, on
a session gated only by the token — treat that token like a password. Don't
commit it, and rotate it (`fly secrets set PAGEGRAB_TOKEN=...`) if it leaks.

### Fly.io idling

`fly.toml` sets `min_machines_running = 0`, so the backend (and its live
browser session) sleeps between uses to save cost, waking on the next
connection within a few seconds. Set it to `1` for an always-warm instance
with no wake delay, at higher cost.

## Roadmap

- **Autoclick macro**: a timed loop that captures, clicks a saved
  coordinate, captures again, and repeats — not yet built. The WebSocket
  protocol (`server/index.js`) is set up to add this as a new message type
  (e.g. `autoclick-start` / `autoclick-stop`) without restructuring anything.
