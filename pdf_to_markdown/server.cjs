// Same-origin, server-only upload bridge and static build host. No PDF body logging.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { isIP } = require('node:net');
const { createPaygate } = require('./paygate.cjs');
const { identityFor } = require('./identity.cjs');

const MAX_REQUEST = 10485760 + 65536; // PDF limit plus multipart headers/boundary.
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ico': 'image/x-icon', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };

function createServer({ token, apiUrl, buildDir, paygate, stripe, publicBaseUrl, ipSecret, codeSecret, cookieSecret, trustedProxyIp, testMode = false, testHandlers, testCraOrigin }) {
  if (!token) throw new Error('API_TOKEN must be set on the server');
  if (!paygate && !testMode) throw new Error('paygate required outside explicit test mode');
  if (!testMode && (testHandlers || testCraOrigin)) throw new Error('Test-only route/origin override refused');
  if (!publicBaseUrl || !cookieSecret || !isIP(trustedProxyIp)) throw new Error('PUBLIC_BASE_URL, PAYGATE_COOKIE_SECRET and TRUSTED_PROXY_IP required');
  const allowedOrigin = new URL(publicBaseUrl).origin;
  if (testCraOrigin && new URL(testCraOrigin).origin !== testCraOrigin) throw new Error('Invalid test CRA Origin');
  const upstream = new URL(apiUrl);
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password || upstream.pathname !== '/') throw new Error('Invalid API_URL');
  const client = upstream.protocol === 'https:' ? require('node:https') : http;
  return http.createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
    function reject(status, message) { if (!res.headersSent) { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }); res.end(message); } }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const protectedPost = ['/v1/convert', '/v1/checkout', '/v1/redeem'];
    const protectedGet = ['/v1/quota', '/v1/checkout-status'];
    if ((req.method === 'POST' && protectedPost.includes(pathname)) || (req.method === 'GET' && protectedGet.includes(pathname))) {
      if (req.method === 'POST') {
        const origins = req.headersDistinct?.origin;
        let valid = false;
        if (origins?.length === 1) {
          try {
            const origin = new URL(origins[0]);
            valid = origins[0] === origin.origin && (origin.origin === allowedOrigin || (testMode && origin.origin === testCraOrigin));
          } catch { /* invalid, null, or malformed Origin */ }
        }
        if (!valid) return reject(403, 'Forbidden');
      }
      // No live route yet for Task 3/4: only explicit test-mode handlers exercise this common guard.
      if (pathname !== '/v1/convert' && !(testMode && testHandlers?.[pathname])) return reject(405, 'Method not allowed');
      let identity;
      try { identity = identityFor(req, res, { cookieSecret, trustedProxyIp }); }
      catch { return reject(503, 'Client IP unavailable'); }
      if (testMode && testHandlers?.[pathname]) return testHandlers[pathname](req, res, identity);
    }
    if (pathname === '/v1/convert') {
      if (req.method !== 'POST') return reject(405, 'Method not allowed');
      // Task 3 wires reservations; never expose an unmetered production path.
      if (paygate) return reject(503, 'Conversion temporarily unavailable');
      if (!/^multipart\/form-data;\s*boundary=/.test(req.headers['content-type'] || '')) return reject(400, 'Expected PDF upload');
      if (Number(req.headers['content-length']) > MAX_REQUEST) {
        req.on('end', () => reject(413, 'PDF exceeds size limit'));
        req.resume(); // drain without buffering; avoid resetting a client still sending
        return;
      }
      let bytes = 0, stopped = false;
      const proxy = client.request(new URL('/v1/convert', upstream), { method: 'POST', headers: {
        'authorization': `Bearer ${token}`,
        'content-type': req.headers['content-type'],
        ...(req.headers['content-length'] ? { 'content-length': req.headers['content-length'] } : {}),
      } }, response => {
        if (stopped) return response.resume();
        const allowed = [200, 400, 401, 413, 422].includes(response.statusCode) ? response.statusCode : 502;
        if (allowed === 200) {
          res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': 'attachment; filename="document.md"' });
          response.pipe(res);
        } else {
          response.resume(); // never reflect upstream details to a user
          reject(allowed, allowed === 413 ? 'PDF exceeds size limit' : allowed === 422 ? 'PDF cannot be converted' : 'Conversion failed');
        }
      });
      proxy.setTimeout(60000, () => proxy.destroy());
      proxy.on('error', () => { if (!stopped) reject(502, 'Conversion unavailable'); });
      req.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_REQUEST && !stopped) {
          stopped = true;
          proxy.destroy();
          reject(413, 'PDF exceeds size limit');
          req.resume();
        } else if (!stopped && !proxy.write(chunk)) req.pause();
      });
      proxy.on('drain', () => req.resume());
      req.on('end', () => { if (!stopped) proxy.end(); });
      req.on('aborted', () => proxy.destroy());
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return reject(405, 'Method not allowed');
    const route = ['/', '/impressum', '/datenschutz'].includes(pathname) ? '/index.html' : pathname;
    let decoded;
    try { decoded = decodeURIComponent(route); } catch { return reject(400, 'Bad path'); }
    const root = path.resolve(buildDir);
    const file = path.resolve(root, '.' + decoded);
    if (!file.startsWith(root + path.sep)) return reject(404, 'Not found');
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) return reject(404, 'Not found');
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  });
}

function validatedConfig(env) {
  const required = ['API_TOKEN', 'PAYGATE_DATABASE_URL', 'PAYGATE_IP_SECRET', 'PAYGATE_CODE_SECRET', 'PAYGATE_COOKIE_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID', 'PUBLIC_BASE_URL', 'TRUSTED_PROXY_IP'];
  for (const key of required) if (!env[key] || !String(env[key]).trim()) throw new Error(`${key} required`);
  let database, base;
  try { database = new URL(env.PAYGATE_DATABASE_URL); } catch { throw new Error('Invalid PAYGATE_DATABASE_URL'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || database.username !== 'paygate_pdf2md' || !database.password || database.pathname !== '/paygate') throw new Error('Invalid PAYGATE_DATABASE_URL role/database');
  const secrets = ['PAYGATE_IP_SECRET', 'PAYGATE_CODE_SECRET', 'PAYGATE_COOKIE_SECRET'];
  for (const key of secrets) {
    const value = env[key];
    const bytes = /^[0-9a-f]+$/i.test(value) && value.length % 2 === 0 ? Buffer.from(value, 'hex').length : Buffer.byteLength(value);
    const repeated = Array.from({ length: Math.floor(value.length / 2) }, (_, i) => i + 1).some(size => value.length % size === 0 && value === value.slice(0, size).repeat(value.length / size));
    if (bytes < 32 || new Set(value).size < 8 || repeated) throw new Error(`${key} must be independently generated (>=32 random bytes)`);
  }
  if (new Set(secrets.map(key => env[key])).size !== 3) throw new Error('PAYGATE_IP_SECRET/PAYGATE_CODE_SECRET/PAYGATE_COOKIE_SECRET must differ');
  try { base = new URL(env.PUBLIC_BASE_URL); } catch { throw new Error('Invalid PUBLIC_BASE_URL'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Invalid PUBLIC_BASE_URL (HTTPS required)');
  if (!isIP(env.TRUSTED_PROXY_IP)) throw new Error('Invalid TRUSTED_PROXY_IP');
  return env;
}

function validSeed(row, priceId) {
  return row && row.role === 'paygate_pdf2md' && row.app_active === true && row.product_active === true && row.timezone === 'Europe/Berlin' &&
    row.free_units_per_day === 5 && row.free_units_per_day_ip === 15 && row.free_limits?.max_file_bytes === 1048576 &&
    row.stripe_price_id === priceId && row.amount_cents === 200 && row.currency === 'eur' && row.units === 50 &&
    row.quota_period === 'day' && row.valid_days === 30 && row.limits?.max_file_bytes === 10485760;
}

async function createConfiguredServer(env, { paygateFactory = createPaygate, stripeFactory = key => new (require('stripe'))(key) } = {}) {
  validatedConfig(env); // reject before touching network or creating clients
  const paygate = paygateFactory({ databaseUrl: env.PAYGATE_DATABASE_URL, ipSecret: env.PAYGATE_IP_SECRET });
  try {
    const row = await paygate.verifyStartup();
    if (!validSeed(row, env.STRIPE_PRICE_ID)) throw new Error('paygate role/product configuration mismatch');
    const stripe = stripeFactory(env.STRIPE_SECRET_KEY);
    return createServer({ token: env.API_TOKEN, apiUrl: env.API_URL || 'http://127.0.0.1:8000', buildDir: path.join(__dirname, 'build'),
      paygate, stripe, publicBaseUrl: env.PUBLIC_BASE_URL, ipSecret: env.PAYGATE_IP_SECRET,
      codeSecret: env.PAYGATE_CODE_SECRET, cookieSecret: env.PAYGATE_COOKIE_SECRET, trustedProxyIp: env.TRUSTED_PROXY_IP });
  } catch (error) {
    await paygate.close();
    throw error;
  }
}

if (require.main === module) {
  createConfiguredServer(process.env).then(server => {
    server.listen(Number(process.env.PORT || 3001), process.env.HOST || '127.0.0.1', () => console.log('PDF frontend listening (no document logging)'));
  }).catch(error => { console.error('PDF frontend startup refused:', error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[database URL redacted]')); process.exitCode = 1; });
}
module.exports = { createServer, createConfiguredServer };
