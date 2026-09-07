const STORAGE_KEY = 'pagegrab-mode';

chrome.storage.local.get(STORAGE_KEY).then((stored) => {
  const saved = stored[STORAGE_KEY];
  if (!saved) return;
  const input = document.querySelector(`input[name="mode"][value="${saved}"]`);
  if (input) input.checked = true;
});

document.getElementById('capture').addEventListener('click', async () => {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  await chrome.storage.local.set({ [STORAGE_KEY]: mode });
  await chrome.runtime.sendMessage({ target: 'pagegrab-popup', type: 'capture', mode });
  window.close();
});
