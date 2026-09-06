# PageGrab

A browser extension that captures the **entire scrolled page** (not just
what's visible) as a PNG, in one click. No server, no hosting, no cost, no
account.

## How it works

It uses `chrome.debugger` to attach the Chrome DevTools Protocol directly to
your active tab, reads the page's true content size
(`Page.getLayoutMetrics`), and calls `Page.captureScreenshot` with
`captureBeyondViewport: true` clipped to that full size — the same technique
Puppeteer uses for `page.screenshot({ fullPage: true })`, just run locally
against your own tab instead of a remote browser. See `extension/background.js`.

## Install

No build step, no npm, no download beyond getting these files onto disk.

1. Download this repo (Code → Download ZIP on GitHub, or `git clone`) and
   unzip it if needed.
2. Open `chrome://extensions` (or `edge://extensions` on Microsoft Edge —
   same steps, it's Chromium-based).
3. Turn on **Developer mode** (toggle, usually top-right in Chrome /
   bottom-left in Edge).
4. Click **Load unpacked** and select the `extension/` folder (the one
   containing `manifest.json`).

A PageGrab icon appears in your toolbar (pin it via the puzzle-piece menu if
it's hidden).

## Use

1. Open any webpage.
2. Click the PageGrab toolbar icon.
3. The badge shows `...` while it captures, then `✓`.
4. The full-page PNG lands in your normal Downloads folder as
   `pagegrab-<timestamp>.png`.

If it shows `ERR`, open `chrome://extensions` → PageGrab → **service
worker** to see the console error.

## Note on the debugger banner

Chrome shows a "PageGrab is debugging this browser" banner while
`chrome.debugger` is attached — this is a mandatory, non-optional Chrome
security indicator for any extension using that API, not a bug. It appears
only for the ~1 second a capture takes.

## Publishing (optional)

Loading unpacked works indefinitely and costs nothing, but needs re-loading
if you reinstall the browser. To install it more permanently:
- Chrome Web Store: one-time $5 developer registration fee.
- Firefox Add-ons: free to publish.

## Roadmap

- **Autoclick macro**: a timed loop that captures, clicks a saved
  coordinate, captures again, and repeats. Not yet built.
