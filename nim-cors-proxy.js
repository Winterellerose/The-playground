#!/usr/bin/env node
/* ═══ nim-cors-proxy.js — NVIDIA NIM CORS Relay ═════════════════════════════
   NVIDIA's integrate.api.nvidia.com sends NO Access-Control-Allow-Origin header,
   so browsers block ALL calls (key test, /models, chat). This tiny relay adds
   the required headers and forwards requests.

   Usage:
     npx nim-cors-proxy.js           # runs on http://localhost:8765
     npx nim-cors-proxy.js --port 9999

   Then in The Playground: Settings → NVIDIA NIM → CORS relay → http://localhost:8765

   Deploy to Cloudflare Workers (free):
     1. wrangler init nim-cors-proxy
     2. Replace index.js with this file (adapt for Workers runtime)
     3. wrangler deploy
     4. Use the workers.dev URL as the relay
   ════════════════════════════════════════════════════════════════════════════ */

import { createServer } from 'node:http';
import { parse } from 'node:url';
import { createHash } from 'node:crypto';

const TARGET = 'https://integrate.api.nvidia.com';
const DEFAULT_PORT = 8765;
const ALLOWED_ORIGINS = [
  'http://localhost:8000',  // npm run dev
  'http://127.0.0.1:8000',
  'http://localhost:8765',  // self
  'http://127.0.0.1:8765',
  // file:// origin is 'null' — handled separately
];

function parseArgs() {
  const args = process.argv.slice(2);
  const port = args.includes('--port') ? parseInt(args[args.indexOf('--port') + 1], 10) : DEFAULT_PORT;
  const target = args.includes('--target') ? args[args.indexOf('--target') + 1] : TARGET;
  return { port, target };
}

function corsHeaders(origin) {
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, X-Requested-With',
    'Access-Control-Allow-Credentials': 'false',
    'Access-Control-Max-Age': '86400',
  };
  // file:// origins send 'null' — echo it back
  if (origin === 'null' || ALLOWED_ORIGINS.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
  } else if (origin?.startsWith('http://localhost:') || origin?.startsWith('http://127.0.0.1:')) {
    h['Access-Control-Allow-Origin'] = origin;  // allow any localhost port
  }
  return h;
}

function log(req, res, start, body = '') {
  const ms = Date.now() - start;
  const status = res.statusCode;
  const color = status >= 400 ? '\x1b[31m' : status >= 300 ? '\x1b[33m' : '\x1b[32m';
  const dim = '\x1b[2m';
  const reset = '\x1b[0m';
  console.log(`${dim}[${new Date().toISOString()}]${reset} ${req.method} ${req.url} ${color}${status}${reset} ${ms}ms`);
  if (body && process.env.DEBUG) console.log(dim + body.slice(0, 500) + reset);
}

const { port, target } = parseArgs();
const targetUrl = new URL(target);

console.log(`🚀 NVIDIA NIM CORS Relay`);
console.log(`   Target: ${target}`);
console.log(`   Listening: http://localhost:${port}`);
console.log(`   Configure in Playground: Settings → NVIDIA NIM → CORS relay → http://localhost:${port}`);
console.log('');

const server = createServer(async (req, res) => {
  const start = Date.now();
  const origin = req.headers.origin || 'null';
  const cors = corsHeaders(origin);

  // Preflight
  if (req.method === 'OPTIONS') {
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
    res.writeHead(204);
    return res.end();
  }

  // Proxy the request
  const parsed = parse(req.url, true);
  const path = parsed.pathname + (parsed.search || '');

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || 443,
    path,
    method: req.method,
    headers: {
      ...req.headers,
      host: targetUrl.hostname,
      origin: target,  // forward our origin to NVIDIA
    },
  };

  // Remove hop-by-hop headers
  delete options.headers['connection'];
  delete options.headers['transfer-encoding'];

  const proxyReq = require('node:https').request(options, proxyRes => {
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));

    // Copy response headers (except hop-by-hop)
    Object.entries(proxyRes.headers).forEach(([k, v]) => {
      if (!['connection', 'transfer-encoding', 'content-encoding'].includes(k.toLowerCase())) {
        res.setHeader(k, v);
      }
    });

    res.writeHead(proxyRes.statusCode);

    let body = '';
    proxyRes.on('data', chunk => {
      body += chunk;
      res.write(chunk);
    });
    proxyRes.on('end', () => {
      res.end();
      log(req, res, start, body);
    });
  });

  proxyReq.on('error', err => {
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
    res.writeHead(502);
    res.end(JSON.stringify({ error: 'Bad gateway', message: err.message }));
    log(req, res, start, err.message);
  });

  // Pipe request body
  req.on('data', chunk => proxyReq.write(chunk));
  req.on('end', () => proxyReq.end());
});

server.listen(port, () => {
  console.log(`✅ Relay ready on http://localhost:${port}`);
  console.log(`   Test: curl -H "Origin: http://localhost:8000" http://localhost:${port}/v1/models`);
});

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  server.close(() => process.exit(0));
});