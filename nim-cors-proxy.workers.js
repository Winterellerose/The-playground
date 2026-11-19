// Deploy with: npx wrangler deploy nim-cors-proxy.workers.js
// Set ALLOWED_ORIGINS to comma-separated exact hosted app origins.
import { allowedOrigin, corsHeaders, allowedRoute } from './relay-policy.js';
const TARGET = 'https://integrate.api.nvidia.com';
export default {
  async fetch(request, env = {}) {
    const origin = request.headers.get('Origin') || 'null';
    if (!allowedOrigin(origin, env.ALLOWED_ORIGINS)) return new Response('Origin not allowed', { status: 403 });
    const cors = corsHeaders(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (!allowedRoute(request.method, url.pathname)) return new Response('Route not allowed', { status: 404, headers: cors });
    const target = new URL(TARGET);
    target.pathname = url.pathname;
    target.search = url.search;
    const headers = new Headers();
    for (const name of ['Authorization', 'Content-Type', 'Accept']) {
      if (request.headers.has(name)) headers.set(name, request.headers.get(name));
    }
    try {
      const response = await fetch(target, {
        method: request.method, headers, signal: request.signal,
        body: request.method === 'POST' ? request.body : undefined,
        redirect: 'manual',
      });
      const responseHeaders = new Headers(response.headers);
      for (const name of [...responseHeaders.keys()]) if (name.startsWith('access-control-')) responseHeaders.delete(name);
      for (const [key, value] of Object.entries(cors)) responseHeaders.set(key, value);
      responseHeaders.delete('Connection');
      responseHeaders.delete('Transfer-Encoding');
      return new Response(response.body, { status: response.status, headers: responseHeaders });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Bad gateway', message: error.message }), {
        status: 502, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  },
};
