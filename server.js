'use strict';
// Hallownest Clicker companion server — Node.js built-ins only.
// Set HK_OWNER_KEY in the server environment. Never put the key in public HTML.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 8080);
const OWNER_KEY = String(process.env.HK_OWNER_KEY || '');
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'global-messages.json');
const MAX_BODY = 16 * 1024;
const MAX_MESSAGES = 200;
const players = new Map();
let messages = [];
try {
  const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (Array.isArray(parsed)) messages = parsed.slice(-MAX_MESSAGES);
} catch { /* First run: no message history yet. */ }

function safeText(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (Buffer.byteLength(data) > MAX_BODY) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
function saveMessages() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(messages, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DATA_FILE);
}
function stats() {
  const cutoff = Date.now() - 45_000;
  for (const [id, last] of players) if (last < cutoff) players.delete(id);
  return { online: players.size, onlineCount: players.size };
}
function ownerAuthorized(req) {
  if (!OWNER_KEY || OWNER_KEY.length < 16) return false;
  const provided = String(req.headers['x-owner-key'] || '');
  const a = Buffer.from(provided);
  const b = Buffer.from(OWNER_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = url.pathname;
  if (req.method === 'GET' && route === '/api/chat/messages') {
    return json(res, 200, { messages: messages.slice(-60) });
  }
  if (req.method === 'POST' && route === '/api/chat/send') {
    if (!OWNER_KEY || OWNER_KEY.length < 16) return json(res, 503, { error: 'Server owner key is not configured. Set HK_OWNER_KEY to a long random value.' });
    if (!ownerAuthorized(req)) return json(res, 403, { error: 'Owner authorization failed.' });
    try {
      const body = await readBody(req);
      const message = safeText(body.message, 280);
      if (!message) return json(res, 400, { error: 'Message cannot be empty.' });
      const item = { id: crypto.randomUUID(), author: 'Game Owner', message, time: new Date().toISOString() };
      messages.push(item);
      messages = messages.slice(-MAX_MESSAGES);
      saveMessages();
      return json(res, 201, { ok: true, message: item });
    } catch (err) { return json(res, err.status || 400, { error: err.status === 413 ? 'Request too large.' : 'Invalid request.' }); }
  }
  if (req.method === 'POST' && ['/api/register', '/api/heartbeat'].includes(route)) {
    try {
      const body = await readBody(req);
      const playerId = safeText(body.playerId, 100);
      if (!playerId) return json(res, 400, { error: 'playerId required' });
      players.set(playerId, Date.now());
      return json(res, 200, stats());
    } catch { return json(res, 400, { error: 'Invalid request.' }); }
  }
  if (req.method === 'POST' && route === '/api/leave') {
    try { const body = await readBody(req); players.delete(safeText(body.playerId, 100)); }
    catch { /* Leave is best-effort. */ }
    return json(res, 200, stats());
  }
  if (req.method === 'GET' && (route === '/' || route === '/index.html')) {
    const file = path.join(ROOT, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    return fs.createReadStream(file).pipe(res);
  }
  return json(res, 404, { error: 'Not found' });
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Hallownest Clicker server listening on port ${PORT}`);
  if (!OWNER_KEY || OWNER_KEY.length < 16) console.warn('WARNING: Set HK_OWNER_KEY to a random secret at least 16 characters long before using owner announcements.');
  else console.log('Owner announcement authorization is configured.');
});
