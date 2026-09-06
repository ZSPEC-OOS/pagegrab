# PageGrab

A browser extension that captures the **entire scrolled page** (not just
what's visible) as a PNG, in one click. No server, no hosting, no cost, no
account.

## How it works

It scrolls the page's content in increments, screenshots each visible frame
(`chrome.tabs.captureVisibleTab`), and stitches the tiles into one image on
an offscreen canvas. Before scrolling, it hides any `position: fixed` /
`sticky` elements (headers, sidebars) so they don't get re-captured in every
tile, and it scrolls whichever element actually has the scrollable content —
either the page itself, or an inner container, for apps (like Canvas LMS)
that put a fixed header/sidebar around a separately-scrolling content area.
See `extension/background.js`.

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

Longer pages take a bit longer than a single instant capture, since it's
now one screenshot per screen-height rather than one shot of the whole
page — a page 5 screens tall takes a few seconds, not a fraction of one.

## Publishing (optional)

Loading unpacked works indefinitely and costs nothing, but needs re-loading
if you reinstall the browser. To install it more permanently:
- Chrome Web Store: one-time $5 developer registration fee.
- Firefox Add-ons: free to publish.

## Roadmap

- **Autoclick macro**: a timed loop that captures, clicks a saved
  coordinate, captures again, and repeats. Not yet built.
