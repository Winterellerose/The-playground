/* ═══ nim-cors-proxy.workers.js — Cloudflare Workers version ════════════════
   Deploy: wrangler deploy nim-cors-proxy.workers.js
   Then use the *.workers.dev URL as the CORS relay in Settings.
   ════════════════════════════════════════════════════════════════════════════ */

const TARGET = 'https://integrate.api.nvidia.com';

function corsHeaders(origin) {
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, X-Requested-With',
    'Access-Control-Allow-Credentials': 'false',
    'Access-Control-Max-Age': '86400',
  };
  // Allow any localhost, 127.0.0.1, or file:// (null) origin
  if (origin === 'null' ||
      origin?.startsWith('http://localhost:') ||
      origin?.startsWith('http://127.0.0.1:') ||
      origin?.startsWith('https://') && origin.includes('.workers.dev')) {
    h['Access-Control-Allow-Origin'] = origin;
  }
  return h;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || 'null';
    const cors = corsHeaders(origin);

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // Build target URL
    const targetUrl = new URL(url.pathname + url.search, TARGET);

    // Forward request with modified headers
    const headers = new Headers(request.headers);
    headers.set('Host', targetUrl.hostname);
    headers.set('Origin', TARGET);
    headers.delete('Connection');
    headers.delete('Transfer-Encoding');

    const init = {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      redirect: 'follow',
    };

    try {
      const response = await fetch(targetUrl, init);

      // Build response with CORS headers
      const responseHeaders = new Headers(response.headers);
      Object.entries(cors).forEach(([k, v]) => responseHeaders.set(k, v));
      responseHeaders.delete('Connection');
      responseHeaders.delete('Transfer-Encoding');
      responseHeaders.delete('Content-Encoding');  // let CF handle compression

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Bad gateway', message: err.message }), {
        status: 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  },
};