const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MAX_BODY_BYTES = 256 * 1024;
const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/favicon.ico', ['../.claude-plugin/icon.png', 'image/png']]
]);
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

function scanToolCall(name, body) {
  return new Promise((resolve, reject) => {
    const windows = process.platform === 'win32';
    const scanner = execFile(windows ? 'sh' : '/bin/sh', [path.join(__dirname, 'postguard-hook.sh')], {
      timeout: 3000,
      maxBuffer: 16384,
      killSignal: 'SIGKILL',
      // Git for Windows supplies sh, grep and sed. Pass only runtime essentials,
      // never credentials or shell-startup variables from the parent environment.
      env: windows
        ? { PATH: process.env.PATH || process.env.Path || '', SystemRoot: process.env.SystemRoot || 'C:\\Windows', LC_ALL: 'C' }
        : { PATH: '/usr/bin:/bin', LC_ALL: 'C' }
    }, (err, stdout, stderr) => {
      if (err || stderr.trim()) {
        reject(new Error('PostGuard scanner failed; tool execution denied.'));
        return;
      }
      if (!stdout.trim()) {
        resolve(null);
        return;
      }
      try {
        const decision = JSON.parse(stdout).hookSpecificOutput;
        if (decision?.permissionDecision !== 'deny' ||
            typeof decision.permissionDecisionReason !== 'string' || !decision.permissionDecisionReason.trim()) {
          throw new Error('Unexpected scanner decision');
        }
        resolve(decision.permissionDecisionReason);
      } catch (parseError) {
        reject(new Error('PostGuard returned an invalid decision; tool execution denied.'));
      }
    });
    scanner.stdin.on('error', err => {
      reject(new Error(`PostGuard input failed; tool execution denied: ${err.message}`));
    });
    // Preserve raw JSON so hostile nesting reaches the shared depth validator without re-serialization.
    scanner.stdin.end(`{"tool_name":${JSON.stringify(name)},"tool_input":${body}}`);
  });
}

async function startDashboard({ tools, executeTool }) {
  const token = crypto.randomBytes(32).toString('hex');
  const authorization = Buffer.from(`Bearer ${token}`);
  const assets = new Map(await Promise.all(Array.from(ASSETS, async ([route, [file, type]]) => [
    route, { body: await fs.promises.readFile(path.join(__dirname, '..', 'dashboard', file)), type }
  ])));
  let origin;
  const server = http.createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    function json(status, data) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    }
    if (req.headers.host !== new URL(origin).host ||
        (req.headers.origin !== undefined && req.headers.origin !== origin) ||
        (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']) &&
         !(req.method === 'GET' && req.url === '/' &&
           req.headers['sec-fetch-mode'] === 'navigate' &&
           req.headers['sec-fetch-dest'] === 'document' &&
           req.headers['sec-fetch-user'] === '?1'))) {
      json(403, { error: 'Host or origin is not allowed.' });
      return;
    }
    const asset = assets.get(req.url);
    if (asset && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': asset.type });
      res.end(asset.body);
      return;
    }
    if (!['/api/tools', '/api/call'].includes(req.url)) {
      json(404, { error: 'Route not found.' });
      return;
    }
    const supplied = Buffer.from(req.headers.authorization || '');
    if (supplied.length !== authorization.length || !crypto.timingSafeEqual(supplied, authorization)) {
      json(401, { error: 'Dashboard capability token required. Reopen the launch URL.' });
      return;
    }
    if (req.url === '/api/tools' && req.method === 'GET') {
      json(200, { tools, mode: 'in-memory-reference' });
      return;
    }
    if (req.url !== '/api/call' || req.method !== 'POST') {
      res.setHeader('Allow', req.url === '/api/tools' ? 'GET' : 'POST');
      json(405, { error: 'Method not allowed.' });
      return;
    }
    if (req.headers.origin !== origin ||
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) {
      json(403, { error: 'Same-origin application/json request required.' });
      return;
    }
    if (Number(req.headers['content-length']) > MAX_BODY_BYTES) {
      res.setHeader('Connection', 'close');
      json(413, { error: 'Request exceeds 256 KiB.' });
      return;
    }
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          res.setHeader('Connection', 'close');
          json(413, { error: 'Request exceeds 256 KiB.' });
          return;
        }
        chunks.push(chunk);
      }
      let input;
      const body = Buffer.concat(chunks).toString('utf8');
      try {
        input = JSON.parse(body);
      } catch (err) {
        json(400, { error: 'Invalid JSON body.' });
        return;
      }
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          typeof input.name !== 'string' || input.name.length > 128) {
        json(400, { error: 'Expected a tool name and an arguments object.' });
        return;
      }
      const denied = await scanToolCall(input.name, body);
      if (res.destroyed) return;
      if (denied) {
        json(403, { error: denied });
        return;
      }
      json(200, await executeTool(input.name, input.arguments));
    } catch (err) {
      if (!res.headersSent) json(500, { error: `Dashboard request failed: ${err.message}` });
      else res.destroy(err);
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.timeout = 10000;
  server.keepAliveTimeout = 1000;
  server.maxConnections = 32;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    url: `${origin}/#token=${token}`,
    close: () => new Promise((resolve, reject) => {
      server.close(err => err ? reject(err) : resolve());
      server.closeAllConnections();
    })
  };
}

module.exports = { startDashboard };
