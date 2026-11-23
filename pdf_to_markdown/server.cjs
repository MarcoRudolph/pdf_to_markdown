// Same-origin, server-only upload bridge and static build host. No PDF body logging.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { isIP } = require('node:net');
const { createPaygate } = require('./paygate.cjs');
const { identityFor } = require('./identity.cjs');
const { randomBytes } = require('node:crypto');
const { parsePdf, LIMIT } = require('./upload.cjs');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ico': 'image/x-icon', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };

function createServer({ token, apiUrl, buildDir, paygate, stripe, publicBaseUrl, ipSecret, codeSecret, cookieSecret, trustedProxyIp, testMode = false, testHandlers, testCraOrigin }) {
  if (!token) throw new Error('API_TOKEN must be set on the server');
  try { http.validateHeaderValue('authorization', `Bearer ${token}`); }
  catch { throw new Error('Invalid API_TOKEN'); }
  if (!paygate && !testMode) throw new Error('paygate required outside explicit test mode');
  if (!testMode && (testHandlers || testCraOrigin)) throw new Error('Test-only route/origin override refused');
  if (!publicBaseUrl || !cookieSecret || !isIP(trustedProxyIp)) throw new Error('PUBLIC_BASE_URL, PAYGATE_COOKIE_SECRET and TRUSTED_PROXY_IP required');
  const allowedOrigin = new URL(publicBaseUrl).origin;
  if (testCraOrigin && new URL(testCraOrigin).origin !== testCraOrigin) throw new Error('Invalid test CRA Origin');
  const upstream = new URL(apiUrl);
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password || upstream.pathname !== '/') throw new Error('Invalid API_URL');
  const client = upstream.protocol === 'https:' ? require('node:https') : http;
  let activeUploads = 0;
  async function convert(req, res, identity) {
    const reject = (status, message, json = false) => {
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(status, { 'content-type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8' });
        res.end(json ? JSON.stringify({ error: message }) : message);
      }
    };
    if (!/^multipart\/form-data(?:;|$)/i.test(req.headers['content-type'] || '')) return reject(400, 'Expected PDF upload');
    let file;
    try { file = await parsePdf(req); }
    catch (error) { return reject(error.status === 413 ? 413 : 400, error.status === 413 ? 'PDF exceeds size limit' : 'Expected PDF upload'); }
    if (res.destroyed) return;
    if (file.length > LIMIT) return reject(413, 'PDF exceeds size limit');
    let reservation, kind;
    try {
      if (file.length <= 1048576) { reservation = await paygate.reserveFree(identity.subjectHash, identity.clientIp); kind = 'free'; }
      if (!reservation) { reservation = await paygate.reservePaid(identity.subjectHash); kind = 'paid'; }
    } catch { return reject(503, 'Quota unavailable'); }
    if (!reservation) return reject(402, 'payment_required', true);
    const reconcile = reason => console.error('pdf2md reconciliation required', {
      reason, day: reservation.day, subjectHash: identity.subjectHash,
      ...(kind === 'paid' ? { entitlementId: reservation.entitlement_id } : { ipHash: reservation.ipHash }),
    });
    let settled = false, received200 = false;
    async function settle(reason) {
      if (settled || received200) return;
      settled = true;
      if (reason === 'uncertain') { reconcile('upstream_outcome_unknown'); return; }
      try {
        const refunded = kind === 'free'
          ? await paygate.refundFreeDay(reservation.subjectHash, reservation.ipHash, reservation.day)
          : await paygate.refundPaidDay(reservation.entitlement_id, reservation.day);
        if (!refunded) reconcile('refund_not_confirmed');
      } catch { reconcile('refund_failed'); }
    }
    if (res.destroyed) { await settle('definitive'); return; }
    try {
      const boundary = 'pdf2md-' + randomBytes(18).toString('hex');
      const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="document.pdf"\r\nContent-Type: application/pdf\r\n\r\n`);
      const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
      await new Promise(resolve => {
        let done = false, sent = false, proxy;
        const finish = async (status, message, reason) => {
          if (done) return;
          done = true;
          if (reason) await settle(reason);
          if (status) reject(status, message);
          resolve();
        };
        try {
          proxy = client.request(new URL('/v1/convert', upstream), { method: 'POST', headers: {
            authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}`,
            'content-length': prefix.length + file.length + suffix.length,
          } }, response => {
            if (done) return response.resume();
            try {
              if (response.statusCode === 200) {
                received200 = true; settled = true;
                res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': 'attachment; filename="document.md"' });
                response.pipe(res);
                response.once('end', () => finish());
                response.once('aborted', () => { res.destroy(); finish(); });
                response.once('error', () => { res.destroy(); finish(); });
              } else {
                response.resume();
                const status = [400, 422].includes(response.statusCode) ? response.statusCode : 502;
                finish(status, status === 422 ? 'PDF cannot be converted' : 'Conversion failed', 'definitive');
              }
            } catch {
              response.destroy();
              finish(received200 ? null : 502, 'Conversion unavailable', received200 ? null : 'definitive');
            }
          });
          proxy.once('error', () => finish(502, 'Conversion unavailable', sent ? 'uncertain' : 'definitive'));
          proxy.setTimeout(60000, () => proxy.destroy());
          res.once('close', () => {
            if (!done && !received200) { proxy.destroy(); finish(null, null, sent ? 'uncertain' : 'definitive'); }
            else if (!done) { proxy.destroy(); finish(); }
          });
          proxy.write(prefix);
          sent = true;
          proxy.write(file);
          proxy.end(suffix);
        } catch {
          if (proxy) proxy.destroy();
          finish(502, 'Conversion unavailable', sent ? 'uncertain' : 'definitive');
        }
      });
    } catch {
      await settle('definitive');
      reject(502, 'Conversion unavailable');
    }
  }
  return http.createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
    function reject(status, message) { if (!res.headersSent) { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }); res.end(message); } }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    let release = () => {};
    let conversionRunning = false;
    if (pathname === '/v1/convert' && req.method === 'POST') {
      if (activeUploads >= 8) {
        res.writeHead(429, { 'Retry-After': '1', Connection: 'close', 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Upload capacity exhausted');
        return;
      }
      activeUploads++;
      let released = false;
      release = () => { if (!released) { released = true; activeUploads--; } };
      res.once('close', () => { if (!conversionRunning) release(); });
    }
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
      if (!['/v1/convert', '/v1/quota'].includes(pathname) && !(testMode && testHandlers?.[pathname])) return reject(405, 'Method not allowed');
      let identity;
      try { identity = identityFor(req, res, { cookieSecret, trustedProxyIp }); }
      catch { return reject(503, 'Client IP unavailable'); }
      if (testMode && testHandlers?.[pathname]) return testHandlers[pathname](req, res, identity);
      if (pathname === '/v1/quota') {
        if (!paygate) return reject(503, 'Quota unavailable');
        paygate.quota(identity.subjectHash, identity.clientIp).then(quota => {
          if (!res.destroyed) {
            const free = { ...quota.free, limits: { ...quota.free.limits, max_file_bytes: 1048576 } };
            const paid = quota.paid.map(pass => ({ ...pass, limits: { ...pass.limits, max_file_bytes: LIMIT } }));
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ free, paid }));
          }
        }).catch(() => reject(503, 'Quota unavailable'));
        return;
      }
      if (pathname === '/v1/convert') {
        if (!paygate || !['reserveFree', 'reservePaid', 'refundFreeDay', 'refundPaidDay'].every(method => typeof paygate[method] === 'function')) return reject(503, 'Conversion unavailable');
        conversionRunning = true;
        convert(req, res, identity).catch(() => { if (!res.headersSent && !res.destroyed) reject(503, 'Conversion unavailable'); }).finally(release);
        return;
      }
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
  try { http.validateHeaderValue('authorization', `Bearer ${env.API_TOKEN}`); }
  catch { throw new Error('Invalid API_TOKEN'); }
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

async function createConfiguredServer(env, { paygateFactory = createPaygate, stripeFactory = key => new (require('stripe'))(key), activeProducts } = {}) {
  validatedConfig(env); // reject before touching network or creating clients
  const paygate = paygateFactory({ databaseUrl: env.PAYGATE_DATABASE_URL, ipSecret: env.PAYGATE_IP_SECRET });
  try {
    const row = await paygate.verifyStartup();
    if (!validSeed(row, env.STRIPE_PRICE_ID)) throw new Error('paygate role/product configuration mismatch');
    // consume_paid has no size argument: every active product must share this limit.
    if (activeProducts || paygateFactory === createPaygate) {
      const list = activeProducts || (async databaseUrl => {
        const db = new (require('pg').Client)({ connectionString: databaseUrl });
        try {
          await db.connect();
          const { rows } = await db.query({ text: 'select quota_period, limits from paygate.products where app_id = $1 and active = true', values: ['pdf2md'] });
          return rows;
        } finally { await db.end(); }
      });
      const products = await list(env.PAYGATE_DATABASE_URL);
      if (!Array.isArray(products) || products.length === 0 || products.some(product => product.quota_period !== 'day' || product.limits?.max_file_bytes !== LIMIT)) {
        throw new Error('paygate active product quota/limit mismatch');
      }
    }
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
