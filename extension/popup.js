const STORAGE_KEY = 'pagegrab-mode';

const innerPicker = document.getElementById('inner-picker');
const pickStatus = document.getElementById('pick-status');

function currentMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function send(msg) {
  return chrome.runtime.sendMessage({ target: 'pagegrab-popup', ...msg });
}

async function refreshPickStatus() {
  pickStatus.textContent = 'Checking…';
  const res = await send({ type: 'pick-status' });
  pickStatus.textContent = '';

  if (res?.info) {
    const label = document.createElement('div');
    const cls = res.info.cls ? `.${res.info.cls}` : '';
    label.textContent = `Using: <${res.info.tag}${cls}> (${res.info.w}×${res.info.h})`;
    const clear = document.createElement('button');
    clear.textContent = 'Clear pick';
    clear.type = 'button';
    clear.className = 'link';
    clear.addEventListener('click', async () => {
      await send({ type: 'pick-clear' });
      refreshPickStatus();
    });
    pickStatus.append(label, clear);
  } else {
    pickStatus.textContent = 'No element picked — auto-detects the largest scroll area.';
  }
}

function updatePickerVisibility() {
  innerPicker.hidden = currentMode() !== 'inner';
  if (!innerPicker.hidden) refreshPickStatus();
}

chrome.storage.local.get(STORAGE_KEY).then((stored) => {
  const saved = stored[STORAGE_KEY];
  if (saved) {
    const input = document.querySelector(`input[name="mode"][value="${saved}"]`);
    if (input) input.checked = true;
  }
  updatePickerVisibility();
});

document.querySelectorAll('input[name="mode"]').forEach((input) => {
  input.addEventListener('change', updatePickerVisibility);
});

document.getElementById('pick').addEventListener('click', async () => {
  await send({ type: 'pick-start' });
  window.close();
});

document.getElementById('capture').addEventListener('click', async () => {
  const mode = currentMode();
  await chrome.storage.local.set({ [STORAGE_KEY]: mode });
  await send({ type: 'capture', mode });
  window.close();
});
