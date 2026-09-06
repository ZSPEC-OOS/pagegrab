# PageGrab

A tiny Electron desktop app: browse to any site in-app, then capture the
**entire page** — including everything below the fold that would normally
require scrolling — as a single PNG.

## How it works

The browsing pane is a `<webview>`. Clicking **Capture Full Page** attaches
the Chrome DevTools Protocol to that page, reads its full content size
(`Page.getLayoutMetrics`), and calls `Page.captureScreenshot` with
`captureBeyondViewport: true` clipped to the full page height. Chrome renders
and stitches the whole page in one shot — no manual scroll-and-crop needed.
This is the same technique Puppeteer uses for `page.screenshot({ fullPage: true })`.

## Run it

```bash
npm install
npm start
```

## Use it

1. Type a URL in the address bar and press Enter (or click **Go**).
2. Browse normally — back/forward/reload work like a regular browser.
3. Click **Capture Full Page**.
4. Pick where to save the `.png` in the dialog that appears.
