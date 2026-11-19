// Shared by the Node relay and Cloudflare Worker. Never use substring matching.
export function allowedOrigin(origin, extra = '') {
  if (origin === 'null') return true; // Explicitly supports portable file:// clients.
  try {
    const url = new URL(origin);
    if (url.origin !== origin) return false;
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return true;
    return extra.split(',').map(x => x.trim()).filter(Boolean).includes(origin);
  } catch {
    return false;
  }
}
export function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
export function allowedRoute(method, pathname) {
  return (method === 'GET' && pathname === '/v1/models') ||
    (method === 'POST' && pathname === '/v1/chat/completions');
}
export function stripHopHeaders(headers) {
  const out = { ...headers };
  const names = String(out.connection || '').split(',').map(x => x.trim().toLowerCase());
  for (const name of [...names, 'connection', 'transfer-encoding', 'keep-alive', 'upgrade',
    'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'host', 'origin']) delete out[name];
  return out;
}
