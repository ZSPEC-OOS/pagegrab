function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode a captured tile'));
    img.src = src;
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'pagegrab-offscreen' || msg.type !== 'stitch') return false;

  (async () => {
    try {
      const { shots, totalHeight, rect, devicePixelRatio } = msg.payload;
      const sx = Math.round(rect.left * devicePixelRatio);
      const sy = Math.round(rect.top * devicePixelRatio);
      const sw = Math.round(rect.width * devicePixelRatio);
      const sh = Math.round(rect.height * devicePixelRatio);

      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = Math.round(totalHeight * devicePixelRatio);
      const ctx = canvas.getContext('2d');

      // Each captured tile is a screenshot of the whole browser viewport,
      // not just the scrolling container - crop to the container's
      // on-screen rectangle before placing it at its vertical offset.
      for (const shot of shots) {
        const img = await loadImage(shot.dataUrl);
        ctx.drawImage(img, sx, sy, sw, sh, 0, Math.round(shot.y * devicePixelRatio), sw, sh);
      }

      sendResponse({ ok: true, dataUrl: canvas.toDataURL('image/png') });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true; // keep the message channel open for the async sendResponse
});
