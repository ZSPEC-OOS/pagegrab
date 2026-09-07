# PageGrab

A browser extension that captures a full scrolled page or an inner
scrolling panel (not just what's visible) as a PNG, in one click. No
server, no hosting, no cost, no account.

## How it works

Clicking the toolbar icon opens a small popup with two capture modes:

- **Whole page** (default): captures the entire document.
  1. **Un-clips nested scroll boxes.** Rich-text editors, comment boxes, and
     other small independently-scrolling elements get their height/overflow
     constraints temporarily removed so their full content joins the normal
     page flow — otherwise anything clipped inside one (e.g. a long typed
     answer in a bounded-height text box) would never be captured at all.
  2. Scrolls the whole document/window.
- **Inner scroll area**: skips the un-clip step and instead auto-detects
  the scrollable descendant with the most hidden content (the dominant
  nested pane — a chat log, editor, or answer box) and scrolls *that
  element* instead of the window. Use this when the content you care about
  lives in a nested scroller that doesn't reflow cleanly when un-clipped
  (virtualized lists, custom scroll widgets) — the result is a PNG of just
  that panel, fully expanded.

Both modes:
1. **Hide fixed/sticky chrome** (headers, sidebars) for the duration of
   the capture, so they don't get re-captured in every tile.
2. **Scroll in increments**, screenshotting each visible frame
   (`chrome.tabs.captureVisibleTab`) and stitching the tiles into one image
   on an offscreen canvas, cropped to the captured region.
3. **Restore everything** back to how it was.

Your last-used mode is remembered for next time.

See `extension/background.js`. Because step 3 has to actually move your
visible scroll position (there's no way to screenshot what isn't on
screen), you'll see the page scroll during a capture — that's expected, not
a bug, and it's the safer trade-off: the alternative (loading the page fresh
in a hidden tab instead) risks capturing a different state than what's
actually on your screen, e.g. missing an in-progress, unsaved answer.

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
3. Pick **Whole page** or **Inner scroll area**, then click **Capture**.
4. The badge shows `...` while it captures, then `✓`.
5. The PNG lands in your normal Downloads folder as
   `pagegrab-<timestamp>.png` (or `pagegrab-inner-<timestamp>.png`).

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
