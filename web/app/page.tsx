'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Must match the VIEWPORT the backend sets in server/index.js.
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;

type ServerMessage =
  | { type: 'authed' }
  | { type: 'frame'; data: string }
  | { type: 'navigated'; url: string }
  | { type: 'capture'; data: string }
  | { type: 'error'; message: string };

function downloadPng(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pagegrab-${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function normalizeUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) return value;
  return `https://${value}`;
}

export default function Page() {
  const [backendUrl, setBackendUrl] = useState('');
  const [token, setToken] = useState('');
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [addressValue, setAddressValue] = useState('');
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [status, setStatus] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const savedUrl = localStorage.getItem('pagegrab.backendUrl');
    setBackendUrl(savedUrl ?? process.env.NEXT_PUBLIC_BACKEND_URL ?? '');
    setToken(localStorage.getItem('pagegrab.token') ?? '');
  }, []);

  const connect = useCallback(() => {
    if (!backendUrl || !token) {
      setStatus('Enter both a backend URL and a token.');
      return;
    }
    localStorage.setItem('pagegrab.backendUrl', backendUrl);
    localStorage.setItem('pagegrab.token', token);

    setConnecting(true);
    setStatus('Connecting…');

    const ws = new WebSocket(backendUrl);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (event) => {
      const msg: ServerMessage = JSON.parse(event.data);
      switch (msg.type) {
        case 'authed':
          setConnected(true);
          setConnecting(false);
          setStatus('Connected. Click the live view to focus it, then scroll/type as usual.');
          ws.send(JSON.stringify({ type: 'start-view' }));
          break;
        case 'frame':
          setFrameSrc(`data:image/jpeg;base64,${msg.data}`);
          break;
        case 'navigated':
          setAddressValue(msg.url);
          break;
        case 'capture':
          downloadPng(msg.data);
          setCapturing(false);
          setStatus('Saved.');
          break;
        case 'error':
          setStatus(`Error: ${msg.message}`);
          setCapturing(false);
          break;
      }
    };

    ws.onerror = () => {
      setStatus('Connection error.');
      setConnecting(false);
    };

    ws.onclose = () => {
      setConnected(false);
      setConnecting(false);
      setFrameSrc(null);
      setStatus((prev) => (prev.startsWith('Error') ? prev : 'Disconnected.'));
    };

    wsRef.current = ws;
  }, [backendUrl, token]);

  useEffect(() => {
    return () => wsRef.current?.close();
  }, []);

  const navigate = () => {
    const url = normalizeUrl(addressValue);
    if (url) wsRef.current?.send(JSON.stringify({ type: 'navigate', url }));
  };

  const capture = () => {
    setCapturing(true);
    setStatus('Capturing full page…');
    wsRef.current?.send(JSON.stringify({ type: 'capture' }));
  };

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const img = imgRef.current;
    if (!img || !wsRef.current) return;
    img.focus();
    const rect = img.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * VIEWPORT_WIDTH;
    const y = ((e.clientY - rect.top) / rect.height) * VIEWPORT_HEIGHT;
    wsRef.current.send(JSON.stringify({ type: 'click', x, y }));
  };

  // Keys with no character of their own (bare modifiers) aren't useful to
  // forward on their own - Puppeteer's press() would just tap them alone.
  const BARE_MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLImageElement>) => {
    if (!wsRef.current || BARE_MODIFIERS.has(e.key)) return;
    e.preventDefault();
    wsRef.current.send(JSON.stringify({ type: 'key', key: e.key }));
  };

  // React's onWheel is passive, so preventDefault() there is a no-op; a
  // manually-attached listener is needed to stop the page itself from
  // scrolling/rubber-banding while a wheel gesture drives the remote page.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      wsRef.current?.send(JSON.stringify({ type: 'wheel', deltaX: e.deltaX, deltaY: e.deltaY }));
    };
    img.addEventListener('wheel', onWheel, { passive: false });
    return () => img.removeEventListener('wheel', onWheel);
  }, [frameSrc === null]);

  if (!connected) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 360 }}>
          <h1 style={{ fontSize: 18, margin: 0 }}>PageGrab</h1>
          <input
            placeholder="Backend URL (wss://your-app.fly.dev)"
            value={backendUrl}
            onChange={(e) => setBackendUrl(e.target.value)}
          />
          <input
            placeholder="Token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button onClick={connect} disabled={connecting}>
            {connecting ? 'Connecting…' : 'Connect'}
          </button>
          {status && <div style={{ fontSize: 12, color: '#b5b8bd' }}>{status}</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: 8,
          background: '#2b2d31',
          borderBottom: '1px solid #1b1c1e',
        }}
      >
        <input
          style={{ flex: 1 }}
          placeholder="Enter a URL and press Enter"
          value={addressValue}
          onChange={(e) => setAddressValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && navigate()}
        />
        <button onClick={navigate}>Go</button>
        <button onClick={capture} disabled={capturing}>
          {capturing ? 'Capturing…' : 'Capture Full Page'}
        </button>
      </div>
      <div style={{ padding: '4px 10px', fontSize: 12, color: '#b5b8bd', background: '#2b2d31', minHeight: 16 }}>
        {status}
      </div>
      <div style={{ flex: 1, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {frameSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            src={frameSrc}
            alt="Live view"
            tabIndex={0}
            onClick={handleImageClick}
            onKeyDown={handleKeyDown}
            style={{ maxWidth: '100%', maxHeight: '100%', cursor: 'pointer', outline: 'none' }}
          />
        ) : (
          <div style={{ color: '#666' }}>Waiting for the live view…</div>
        )}
      </div>
    </div>
  );
}
