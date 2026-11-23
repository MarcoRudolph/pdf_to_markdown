const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHash, createHmac } = require('node:crypto');
const { identityFor } = require('./identity.cjs');
const { createServer } = require('./server.cjs');

const cookieSecret = 'cookie-secret-for-tests-with-enough-randomness';
const publicBaseUrl = 'https://pdf.example.test';
function response() {
  const headers = {};
  return { headers, setHeader(key, value) { headers[key.toLowerCase()] = value; } };
}
function identity(cookie, peer = '127.0.0.1', forwarding, trustedProxyIp = '192.0.2.8') {
  const res = response();
  const req = { socket: { remoteAddress: peer }, headersDistinct: {
    ...(cookie ? { cookie: [cookie] } : {}),
    ...(forwarding === undefined ? {} : { 'cf-connecting-ip': forwarding }),
  } };
  return { result: identityFor(req, res, { cookieSecret, trustedProxyIp }), headers: res.headers };
}

function mintedCookie(headers) { return headers['set-cookie'].split(';')[0]; }

test('new random 128-bit IDs create distinct pseudonymous hashes and secure non-caching cookies', () => {
  const a = identity(); const b = identity();
  const value = mintedCookie(a.headers);
  assert.match(value, /^pdf2md_id=[A-Za-z0-9_-]{22}\.[0-9a-f]{64}$/);
  assert.notEqual(value, mintedCookie(b.headers));
  assert.match(a.result.subjectHash, /^[0-9a-f]{64}$/);
  assert.notEqual(a.result.subjectHash, b.result.subjectHash);
  assert.match(a.headers['set-cookie'], /; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=31536000$/);
  assert.equal(a.headers['cache-control'], 'no-store');
});

test('verified known cookie hashes exactly its unaltered ID with SHA-256', () => {
  const id = 'AAAAAAAAAAAAAAAAAAAAAA'; // base64url of sixteen zero bytes
  const signature = createHmac('sha256', cookieSecret).update('pdf2md_id|' + id).digest('hex');
  const { result, headers } = identity(`pdf2md_id=${id}.${signature}`);
  assert.equal(result.subjectHash, createHash('sha256').update(id, 'utf8').digest('hex'));
  assert.equal(headers['set-cookie'], undefined); // signature verified, not rotated
});

test('valid signed ID preserves subject hash without replacing cookie', () => {
  const first = identity();
  const second = identity(mintedCookie(first.headers));
  assert.equal(first.result.subjectHash, second.result.subjectHash);
  assert.equal(second.headers['set-cookie'], undefined);
  assert.equal(second.headers['cache-control'], 'no-store');
});

test('tampered and malformed cookies rotate rather than reusing an attacker ID', () => {
  const first = identity();
  const cookie = mintedCookie(first.headers);
  for (const bad of [cookie.slice(0, -1) + (cookie.endsWith('0') ? '1' : '0'), 'pdf2md_id=evil', cookie + '; pdf2md_id=evil']) {
    const rotated = identity(bad);
    assert.notEqual(rotated.result.subjectHash, first.result.subjectHash);
    assert.match(rotated.headers['set-cookie'], /^pdf2md_id=/);
  }
});

test('untrusted peers ignore spoofed CF and forwarding headers; mapped IPv4 normalizes to IPv4', () => {
  assert.equal(identity(null, '::ffff:127.0.0.1', ['198.51.100.9'], '192.0.2.8').result.clientIp, '127.0.0.1');
  assert.equal(identity(null, '::ffff:7f00:1', ['198.51.100.9'], '127.0.0.1').result.clientIp, '198.51.100.9');
  assert.equal(identity(null, '0:0:0:0:0:ffff:7f00:1', ['198.51.100.9'], '127.0.0.1').result.clientIp, '198.51.100.9');
  assert.equal(identity(null, '0:0:0:0::ffff:7f00:1', ['198.51.100.9'], '127.0.0.1').result.clientIp, '198.51.100.9');
  assert.equal(identity(null, '::ffff:192.0.2.8', ['198.51.100.9'], '192.0.2.8').result.clientIp, '198.51.100.9');
});

test('trusted peer requires exactly one syntactically valid CF-Connecting-IP', () => {
  for (const forwarding of [undefined, [], ['1.2.3.4', '5.6.7.8'], ['1.2.3.4, 5.6.7.8'], ['not-an-ip'], [''], [' 1.2.3.4 ']]) {
    assert.throws(() => identity(null, '192.0.2.8', forwarding), /trusted client IP unavailable/);
  }
  assert.equal(identity(null, '192.0.2.8', ['::ffff:198.51.100.9']).result.clientIp, '198.51.100.9');
});

function listen(server) { return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port))); }
function send(port, route, method, headers = [], body = 'should not be read') {
  return new Promise((resolve, reject) => {
    const rawHeaders = method === 'POST' ? ['Host', `127.0.0.1:${port}`, ...headers, 'Content-Length', Buffer.byteLength(body)] : ['Host', `127.0.0.1:${port}`, ...headers];
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method, headers: rawHeaders }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.end(method === 'POST' ? body : undefined);
  });
}

test('each user POST rejects absent, null, malformed, duplicate and foreign Origin before identity or handler', async () => {
  let reached = 0;
  const server = createServer({ token: 'test', apiUrl: 'http://127.0.0.1:1', buildDir: __dirname,
    testMode: true, publicBaseUrl, cookieSecret, trustedProxyIp: '192.0.2.8',
    testHandlers: Object.fromEntries(['/v1/convert', '/v1/checkout', '/v1/redeem'].map(route => [route, (req, res) => { reached++; res.end('reached'); }])) });
  const port = await listen(server);
  try {
    for (const route of ['/v1/convert', '/v1/checkout', '/v1/redeem']) {
      for (const headers of [[], ['Origin', 'null'], ['Origin', 'not a URL'], ['Origin', 'https://other.test'], ['Origin', publicBaseUrl, 'Origin', publicBaseUrl], ['Origin', publicBaseUrl + '/path'], ['Origin', 'http://pdf.example.test']]) {
        const result = await send(port, route, 'POST', headers);
        assert.equal(result.status, 403, `${route}: ${JSON.stringify(headers)}`);
        assert.equal(result.headers['set-cookie'], undefined);
      }
      const result = await send(port, route, 'POST', ['Origin', publicBaseUrl]);
      assert.equal(result.status, 200, route);
      assert.match(result.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Lax/);
    }
    assert.equal(reached, 3);
  } finally { server.close(); }
});

test('test-only CRA origin override is explicit; no production-style implicit localhost allowance', async () => {
  const server = createServer({ token: 'test', apiUrl: 'http://127.0.0.1:1', buildDir: __dirname,
    testMode: true, publicBaseUrl, cookieSecret, trustedProxyIp: '192.0.2.8', testCraOrigin: 'http://localhost:3000',
    testHandlers: { '/v1/redeem': (req, res) => res.end('ok') } });
  const port = await listen(server);
  try {
    assert.equal((await send(port, '/v1/redeem', 'POST', ['Origin', 'http://localhost:3000'])).status, 200);
    assert.equal((await send(port, '/v1/redeem', 'POST', ['Origin', 'http://localhost:3001'])).status, 403);
  } finally { server.close(); }
});

test('trusted proxy missing or ambiguous CF header returns 503 before handler and cookie', async () => {
  const server = createServer({ token: 'test', apiUrl: 'http://127.0.0.1:1', buildDir: __dirname,
    testMode: true, publicBaseUrl, cookieSecret, trustedProxyIp: '127.0.0.1',
    testHandlers: { '/v1/quota': (req, res) => res.end('incorrect') } });
  const port = await listen(server);
  try {
    for (const headers of [[], ['CF-Connecting-IP', '1.2.3.4', 'CF-Connecting-IP', '5.6.7.8'], ['CF-Connecting-IP', '1.2.3.4, 5.6.7.8'], ['CF-Connecting-IP', 'invalid']]) {
      const result = await send(port, '/v1/quota', 'GET', headers);
      assert.equal(result.status, 503);
      assert.equal(result.headers['set-cookie'], undefined);
    }
    const ok = await send(port, '/v1/quota', 'GET', ['CF-Connecting-IP', '198.51.100.9']);
    assert.equal(ok.status, 200);
    assert.ok(ok.headers['set-cookie']);
  } finally { server.close(); }
});

test('future read routes use identity guard; webhook does not issue identity or require Origin', async () => {
  const server = createServer({ token: 'test', apiUrl: 'http://127.0.0.1:1', buildDir: __dirname,
    testMode: true, publicBaseUrl, cookieSecret, trustedProxyIp: '192.0.2.8',
    testHandlers: { '/v1/checkout-status': (req, res, identity) => { assert.match(identity.subjectHash, /^[a-f0-9]{64}$/); res.end('ok'); } } });
  const port = await listen(server);
  try {
    const read = await send(port, '/v1/checkout-status', 'GET');
    assert.equal(read.status, 200);
    assert.ok(read.headers['set-cookie']);
    const webhook = await send(port, '/v1/stripe-webhook', 'POST');
    assert.equal(webhook.headers['set-cookie'], undefined);
    assert.notEqual(webhook.status, 200); // no unsigned webhook processing route exists yet
  } finally { server.close(); }
});
