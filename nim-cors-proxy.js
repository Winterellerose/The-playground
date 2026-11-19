#!/usr/bin/env node
// Local NVIDIA relay. See README.md for hosted-origin configuration.
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { allowedOrigin, corsHeaders, allowedRoute, stripHopHeaders } from './relay-policy.js';

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw Error(`Missing value for ${name}`);
  return args[index + 1];
}
const port = Number(option('--port', '8765'));
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid port');
const host = option('--host', '127.0.0.1');
const target = new URL(option('--target', 'https://integrate.api.nvidia.com'));
if (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname))) {
  throw Error('Target must use HTTPS (HTTP is permitted only for loopback testing)');
}
const server = createServer((req, res) => {
  const origin = req.headers.origin || 'null';
  if (!allowedOrigin(origin, process.env.ALLOWED_ORIGINS)) {
    res.writeHead(403); res.end('Origin not allowed'); return;
  }
  const cors = corsHeaders(origin);
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  // Assign pathname separately: a //host path must never change upstream host.
  const url = new URL(target.origin);
  url.pathname = req.url.split('?')[0];
  url.search = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  if (!allowedRoute(req.method, url.pathname)) { res.writeHead(404, cors); res.end('Route not allowed'); return; }
  const upstream = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
    method: req.method,
    headers: { ...stripHopHeaders(req.headers), origin: target.origin },
  }, response => {
    // Node forwards raw bytes, so keep Content-Encoding and Content-Length.
    const headers = stripHopHeaders(response.headers);
    for (const key of Object.keys(headers)) if (key.startsWith('access-control-')) delete headers[key];
    res.writeHead(response.statusCode, { ...headers, ...cors });
    response.on('error', () => res.destroy());
    response.pipe(res); // Bounded memory and native backpressure.
  });
  upstream.setTimeout(120000, () => upstream.destroy(Error('Upstream timed out')));
  upstream.on('error', error => {
    if (res.destroyed) return;
    if (res.headersSent) { res.destroy(error); return; }
    res.writeHead(502, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad gateway', message: error.message }));
  });
  req.on('aborted', () => upstream.destroy());
  req.on('error', () => upstream.destroy());
  res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
  req.pipe(upstream);
});
server.listen(port, host, () => console.log(`NVIDIA relay listening on http://${host}:${server.address().port}`));
process.on('SIGINT', () => server.close(() => process.exit(0)));
