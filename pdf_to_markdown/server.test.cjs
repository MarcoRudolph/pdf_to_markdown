const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { Readable } = require('node:stream');
const { parsePdf } = require('./upload.cjs');
const { createServer, createConfiguredServer } = require('./server.cjs');
const { createPaygate } = require('./paygate.cjs');
const MiB = 1048576;
const pdf = size => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(size - 9, 65)]);
function multipart(file, { extra = '', second = false } = {}) {
  return Buffer.concat([Buffer.from('--incoming\r\nContent-Disposition: form-data; name="file"; filename="attacker.pdf"\r\nContent-Type: application/x-evil\r\n\r\n'), file,
    Buffer.from('\r\n' + extra + (second ? '--incoming\r\nContent-Disposition: form-data; name="file"; filename="second.pdf"\r\nContent-Type: application/pdf\r\n\r\nBAD\r\n' : '') + '--incoming--\r\n')]);
}
const field = '--incoming\r\nContent-Disposition: form-data; name="other"\r\n\r\nsecret\r\n';
function fakePaygate(overrides = {}) {
  const calls = [];
  return { calls,
    async quota() { calls.push(['quota']); return { day: '2026-10-25', free: { units_left: 5, limits: { max_file_bytes: MiB } }, paid: [] }; },
    async reserveFree(subject, ip) { calls.push(['free', subject, ip]); return { day: '2026-10-25', subjectHash: subject, ipHash: 'day-bound-ip' }; },
    async reservePaid(subject) { calls.push(['paid', subject]); return { day: '2026-10-25', entitlement_id: 'pass-one' }; },
    async refundFreeDay(...args) { calls.push(['refundFree', ...args]); return true; },
    async refundPaidDay(...args) { calls.push(['refundPaid', ...args]); return true; }, ...overrides };
}
function listen(server) { return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port))); }
function close(server) { return new Promise(resolve => server.close(resolve)); }
async function harness(t, { paygate = fakePaygate(), upstreamHandler, uploadBodyTimeoutMs } = {}) {
  const seen = [];
  const upstream = http.createServer((req, res) => { const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => {
    seen.push({ headers: req.headers, body: Buffer.concat(chunks) });
    (upstreamHandler || ((_, response) => response.end('# Real text')))(req, res);
  }); });
  const upPort = await listen(upstream);
  const server = createServer({ token: 'private-only', apiUrl: `http://127.0.0.1:${upPort}`, buildDir: __dirname,
    testMode: true, paygate, publicBaseUrl: 'https://pdf.example.test', testCraOrigin: 'http://localhost:3000',
    cookieSecret: 'test-cookie-secret-which-is-never-live', trustedProxyIp: '192.0.2.8', uploadBodyTimeoutMs });
  const port = await listen(server);
  t.after(async () => { await close(server); await close(upstream); });
  return { port, paygate, seen };
}
async function request(port, body, { path = '/v1/convert', headers = {}, method = 'POST' } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: method === 'POST' ? { 'content-type': 'multipart/form-data; boundary=incoming', origin: 'http://localhost:3000', ...headers } : headers, body });
  return { status: response.status, body: await response.text(), headers: response.headers };
}
test('exactly 1 MiB actual file uses free despite overhead and outbound multipart is sanitized', async t => {
  const { port, paygate, seen } = await harness(t);
  const file = pdf(MiB);
  const result = await request(port, multipart(file));
  assert.equal(result.status, 200); assert.equal(result.body, '# Real text');
  assert.equal(result.headers.get('content-disposition'), 'attachment; filename="document.md"');
  assert.deepEqual(paygate.calls.map(c => c[0]), ['free']); assert.equal(seen.length, 1);
  const { headers, body } = seen[0];
  assert.equal(headers.authorization, 'Bearer private-only'); assert.equal(Number(headers['content-length']), body.length);
  const boundary = /boundary=([\w-]+)/.exec(headers['content-type'])?.[1];
  assert.ok(boundary && boundary !== 'incoming');
  assert.ok(body.subarray(0, body.indexOf(file)).toString().includes('name="file"; filename="document.pdf"\r\nContent-Type: application/pdf\r\n\r\n'));
  assert.deepEqual(body.subarray(body.indexOf(file), body.indexOf(file) + file.length), file);
  assert.ok(body.toString().endsWith(`\r\n--${boundary}--\r\n`));
  assert.doesNotMatch(body.subarray(0, 250).toString(), /attacker|application\/x-evil|other/);
});
test('1 MiB plus one uses paid; exhausted free falls back; no credits 402 without upstream', async t => {
  const gate = fakePaygate(); gate.reserveFree = async () => { gate.calls.push(['free']); return null; };
  const { port, seen } = await harness(t, { paygate: gate });
  assert.equal((await request(port, multipart(pdf(MiB + 1)))).status, 200);
  assert.deepEqual(gate.calls.map(c => c[0]), ['paid']); gate.calls.length = 0;
  assert.equal((await request(port, multipart(pdf(100)))).status, 200);
  assert.deepEqual(gate.calls.map(c => c[0]), ['free', 'paid']);
  gate.reservePaid = async () => { gate.calls.push(['paid']); return null; };
  const denied = await request(port, multipart(pdf(100)));
  assert.equal(denied.status, 402); assert.deepEqual(JSON.parse(denied.body), { error: 'payment_required' });
  assert.equal(seen.length, 2);
});
test('oversize and malformed/second-file/field multipart reject without consuming, regardless of size header', async t => {
  const { port, paygate, seen } = await harness(t);
  assert.equal((await request(port, multipart(pdf(10 * MiB + 1)))).status, 413);
  assert.equal((await request(port, multipart(pdf(100)), { headers: { 'content-length': String(multipart(pdf(100)).length) } })).status, 200);
  paygate.calls.length = 0;
  assert.equal((await request(port, multipart(pdf(100), { second: true }))).status, 400);
  assert.equal((await request(port, multipart(pdf(100), { extra: field }))).status, 400);
  assert.equal((await request(port, Buffer.from('not multipart'))).status, 400);
  assert.equal((await request(port, multipart(pdf(100)), { headers: { 'content-type': 'text/plain' } })).status, 400);
  assert.equal(paygate.calls.length, 0); assert.equal(seen.length, 1);
});
test('API 400/422/500 refunds saved day once, 200 commits without refund', async t => {
  let status = 400;
  const { port, paygate } = await harness(t, { upstreamHandler(req, res) { res.writeHead(status); res.end('SECRET'); } });
  for (const code of [400, 422, 500, 200]) {
    status = code; const result = await request(port, multipart(pdf(100)));
    assert.equal(result.status, code === 500 ? 502 : code);
    if (code !== 200) assert.doesNotMatch(result.body, /SECRET/);
  }
  assert.deepEqual(paygate.calls.filter(c => c[0] === 'refundFree').map(c => c.slice(2)), [
    ['day-bound-ip', '2026-10-25'], ['day-bound-ip', '2026-10-25'], ['day-bound-ip', '2026-10-25']]);
  status = 422;
  assert.equal((await request(port, multipart(pdf(MiB + 1)))).status, 422);
  assert.deepEqual(paygate.calls.filter(c => c[0] === 'refundPaid').map(c => c.slice(1)), [['pass-one', '2026-10-25']]);
});
test('quota exposes two 50-unit passes and DB outages fail closed', async t => {
  const gate = fakePaygate({ async quota() { return { day: '2026-10-25', free: { units_left: 0, limits: { max_file_bytes: 99999999 } }, paid: [
    { units_left: 50, limits: { max_file_bytes: 99999999 }, expires_at: '2026-11-01' },
    { units_left: 50, limits: { max_file_bytes: 99999999 }, expires_at: '2026-11-02' }] }; } });
  const { port } = await harness(t, { paygate: gate });
  const quota = await request(port, undefined, { method: 'GET', path: '/v1/quota' });
  assert.equal(quota.status, 200); assert.equal(quota.headers.get('cache-control'), 'no-store');
  assert.equal(JSON.parse(quota.body).paid.reduce((sum, pass) => sum + pass.units_left, 0), 100);
  assert.equal(JSON.parse(quota.body).free.limits.max_file_bytes, MiB);
  assert.deepEqual(JSON.parse(quota.body).paid.map(pass => pass.limits.max_file_bytes), [10 * MiB, 10 * MiB]);
  gate.reserveFree = async () => { throw Error('database secret'); };
  const failure = await request(port, multipart(pdf(100)));
  assert.equal(failure.status, 503); assert.doesNotMatch(failure.body, /database secret/);
  gate.quota = async () => { throw Error('database secret'); };
  assert.equal((await request(port, undefined, { method: 'GET', path: '/v1/quota' })).status, 503);
});
test('eight uploads hold admission slots before parsing; ninth 429, then release admits next', async t => {
  const { port, paygate, seen } = await harness(t);
  const sockets = [];
  try {
    for (let n = 0; n < 8; n++) {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/v1/convert', method: 'POST', headers: {
        origin: 'http://localhost:3000', 'content-type': 'multipart/form-data; boundary=incoming', 'transfer-encoding': 'chunked',
      } }, res => res.resume());
      req.on('error', () => {});
      req.write('--incoming\r\nContent-Disposition: form-data; name="file"; filename="wait.pdf"\r\n\r\n%PDF-1.7\n');
      sockets.push(req);
    }
    await new Promise(resolve => setTimeout(resolve, 80));
    const denied = await request(port, multipart(pdf(100)));
    assert.equal(denied.status, 429);
    assert.equal(denied.headers.get('retry-after'), '1');
    assert.equal(denied.headers.get('connection'), 'close');
    assert.equal(paygate.calls.length, 0); assert.equal(seen.length, 0);
    sockets[0].end('\r\n--incoming--\r\n');
    await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(Error('slot not released')), 1000);
      const poll = () => { if (seen.length === 1) { clearTimeout(timeout); resolve(); } else setTimeout(poll, 10); }; poll(); });
    assert.equal((await request(port, multipart(pdf(100)))).status, 200);
  } finally { for (const req of sockets) req.destroy(); }
});

test('eight trickling incomplete multipart uploads expire by total deadline and release admission without quota debit', async t => {
  const { port, paygate, seen } = await harness(t, { uploadBodyTimeoutMs: 250 });
  const pending = [];
  const sockets = [];
  try {
    for (let n = 0; n < 8; n++) {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/v1/convert', method: 'POST', headers: {
        origin: 'http://localhost:3000', 'content-type': 'multipart/form-data; boundary=incoming', 'transfer-encoding': 'chunked',
      } });
      sockets.push(req);
      pending.push(new Promise((resolve, reject) => {
        req.on('response', res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        req.on('error', reject);
      }));
      req.write('--incoming\r\nContent-Disposition: form-data; name="file"; filename="wait.pdf"\r\n\r\n%PDF-1.7\n');
    }
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal((await request(port, multipart(pdf(100)))).status, 429);
    // Receiving another chunk must not reset the total body deadline.
    for (const req of sockets) req.write('x');
    assert.deepEqual(await Promise.race([
      Promise.all(pending), new Promise((_, reject) => setTimeout(() => reject(Error('body deadline did not release slots')), 2000)),
    ]), Array(8).fill(408));
    assert.equal(paygate.calls.length, 0);
    assert.equal(seen.length, 0);
    assert.equal((await request(port, multipart(pdf(100)))).status, 200);
  } finally { for (const req of sockets) req.destroy(); }
});

test('completed upload clears body deadline while upstream is still working', async t => {
  const { port, paygate } = await harness(t, { uploadBodyTimeoutMs: 100,
    upstreamHandler(req, res) { setTimeout(() => res.end('# delayed'), 250); } });
  const result = await request(port, multipart(pdf(100)));
  assert.equal(result.status, 200);
  assert.equal(result.body, '# delayed');
  assert.deepEqual(paygate.calls.map(call => call[0]), ['free']);
});

test('upstream 200 followed by truncated downstream never refunds; unknown outcome logs reconciliation', async t => {
  const gate = fakePaygate();
  let truncate = true;
  const { port } = await harness(t, { paygate: gate, upstreamHandler(req, res) {
    if (truncate) { res.writeHead(200, { 'content-length': '10000' }); res.write('partial'); setTimeout(() => res.socket.destroy(), 30); }
    else res.socket.destroy();
  } });
  await assert.rejects(request(port, multipart(pdf(100))));
  assert.equal(gate.calls.filter(c => c[0].startsWith('refund')).length, 0);
  truncate = false;
  const logged = [];
  const prior = console.error;
  console.error = (...parts) => logged.push(parts);
  try { await request(port, multipart(pdf(100))); }
  finally { console.error = prior; }
  assert.equal(gate.calls.filter(c => c[0].startsWith('refund')).length, 0);
  assert.ok(logged.some(entry => entry[0] === 'pdf2md reconciliation required' && entry[1].reason === 'upstream_outcome_unknown'));
  assert.doesNotMatch(JSON.stringify(logged), /private-only|%PDF|attacker/);
});

test('failed refund records reconciliation without retrying', async t => {
  const gate = fakePaygate(); let attempts = 0;
  gate.refundFreeDay = async () => { attempts++; throw Error('db secret'); };
  const { port } = await harness(t, { paygate: gate, upstreamHandler(req, res) { res.writeHead(422); res.end('SECRET'); } });
  const logged = []; const prior = console.error; console.error = (...parts) => logged.push(parts);
  try { assert.equal((await request(port, multipart(pdf(100)))).status, 422); }
  finally { console.error = prior; }
  assert.equal(attempts, 1);
  assert.ok(logged.some(entry => entry[1].reason === 'refund_failed'));
  assert.doesNotMatch(JSON.stringify(logged), /db secret|SECRET/);
});

test('admission stays occupied until refund settlement, including after response ends', async t => {
  const refunds = [];
  const gate = fakePaygate();
  gate.refundFreeDay = async () => new Promise(resolve => { refunds.push(resolve); });
  const { port } = await harness(t, { paygate: gate, upstreamHandler(req, res) { res.writeHead(422); res.end(); } });
  const pending = Array.from({ length: 8 }, () => request(port, multipart(pdf(100))));
  try {
    await new Promise((resolve, reject) => { const deadline = setTimeout(() => reject(Error('refunds not reached')), 2000);
      const poll = () => { if (refunds.length === 8) { clearTimeout(deadline); resolve(); } else setTimeout(poll, 10); }; poll(); });
    assert.equal((await request(port, multipart(pdf(100)))).status, 429);
  } finally { refunds.forEach(resolve => resolve(true)); await Promise.all(pending); }
  gate.refundFreeDay = async () => true;
  assert.equal((await request(port, multipart(pdf(100)))).status, 422);
});

test('fake DB transactions retain DB-selected Berlin day and IP hash across midnight and DST', async t => {
  const days = ['2026-03-29', '2026-03-30', '2026-10-25', '2026-10-26'];
  const statements = []; let transaction = -1;
  const pool = { async connect() { return { async query(statement) {
    const text = typeof statement === 'string' ? statement : statement.text;
    if (text === 'BEGIN') transaction++;
    statements.push({ transaction, text, values: statement.values });
    if (text === 'BEGIN') return { rows: [] };
    if (text.includes("at time zone 'Europe/Berlin'")) return { rows: [{ day: days[transaction] }] };
    if (text === 'select paygate.quota_pdf2md($1,$2) as quota') return { rows: [{ quota: { free: { units_left: 2, limits: {} }, paid: [] } }] };
    if (text === 'select paygate.consume_pdf2md_free($1,$2) as consumed') return { rows: [{ consumed: true }] };
    if (text === 'select paygate.consume_pdf2md_paid($1) as consumed') return { rows: [{ consumed: { entitlement_id: 'pass-one' } }] };
    return { rows: [] };
  }, release() {} }; }, async query(statement) { statements.push({ transaction, text: statement.text, values: statement.values }); return { rows: [{ refunded: true }] }; }, async end() {} };
  const gate = createPaygate({ ipSecret: 'x'.repeat(32), pool });
  const quota = await gate.quota('subject', '192.0.2.9');
  const first = await gate.reserveFree('subject', '192.0.2.9');
  const paid = await gate.reservePaid('subject');
  const second = await gate.reserveFree('subject', '192.0.2.9');
  await gate.refundFreeDay(first.subjectHash, first.ipHash, first.day);
  await gate.refundPaidDay(paid.entitlement_id, paid.day);
  assert.equal(quota.day, '2026-03-29');
  assert.equal(first.day, '2026-03-30'); assert.equal(paid.day, '2026-10-25'); assert.equal(second.day, '2026-10-26');
  assert.notEqual(first.ipHash, second.ipHash);
  assert.deepEqual(statements.find(s => s.text.includes('refund_pdf2md_free_day')).values, ['subject', first.ipHash, '2026-03-30']);
  assert.deepEqual(statements.find(s => s.text.includes('refund_pdf2md_paid_day')).values, ['pass-one', '2026-10-25']);
  for (let index = 0; index < 4; index++) {
    const group = statements.filter(s => s.transaction === index && !s.text.includes('refund_'));
    assert.equal(group[0].text, 'BEGIN');
    assert.ok(group[1].text.includes("at time zone 'Europe/Berlin'"));
    assert.ok(group[2].text.includes('paygate.'));
    assert.equal(group[3].text, 'COMMIT');
  }
  await gate.close();
});

test('startup rejects any other active paid product with a non-day period or unequal 10 MiB limit', async () => {
  const secrets = [
    '9b6f38e4a1d20c7f5e83b49a6d1f072c8e35b9a4f60d217ce98b543af106d82e',
    '71e5a92b4c03f8d65a1b7e90c2d43f6a8b5e197c04d2a63f9b0e85c71d4a2f36',
    '84d31f7a9b20c56e1d48f3a70b25e69c4f18d03a72b56e91c8a4f0d37b26e59a',
  ];
  const env = { API_TOKEN: 'token', PAYGATE_DATABASE_URL: 'postgresql://paygate_pdf2md:password@127.0.0.1:5433/paygate',
    PAYGATE_IP_SECRET: secrets[0], PAYGATE_CODE_SECRET: secrets[1], PAYGATE_COOKIE_SECRET: secrets[2],
    STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_test', STRIPE_PRICE_ID: 'price_test',
    PUBLIC_BASE_URL: 'https://pdf.example.test', TRUSTED_PROXY_IP: '192.0.2.8' };
  const seeded = { role: 'paygate_pdf2md', app_active: true, product_active: true, timezone: 'Europe/Berlin',
    free_units_per_day: 5, free_units_per_day_ip: 15, free_limits: { max_file_bytes: MiB },
    stripe_price_id: 'price_test', amount_cents: 200, currency: 'eur', units: 50, quota_period: 'day',
    valid_days: 30, limits: { max_file_bytes: 10 * MiB } };
  for (const bad of [{ quota_period: 'month', limits: { max_file_bytes: 10 * MiB } },
    { quota_period: 'day', limits: { max_file_bytes: MiB } }]) {
    let closed = false;
    const gate = { async verifyStartup() { return seeded; }, async close() { closed = true; } };
    await assert.rejects(createConfiguredServer(env, { paygateFactory: () => gate, stripeFactory: () => ({}),
      activeProducts: async () => [bad] }), /product|quota/i);
    assert.equal(closed, true);
  }
});

test('invalid bearer token is rejected before any reservation or startup', () => {
  assert.throws(() => createServer({ token: 'bad\nheader', apiUrl: 'http://127.0.0.1:8000', buildDir: __dirname,
    paygate: fakePaygate(), publicBaseUrl: 'https://pdf.example.test', cookieSecret: 'test-cookie-secret',
    trustedProxyIp: '192.0.2.8' }), /API_TOKEN/);
});

test('synchronous upstream request and write exceptions after reservation refund saved day once', async t => {
  const { port, paygate, seen } = await harness(t);
  const original = http.request;
  const logged = []; const priorError = console.error;
  console.error = (...args) => logged.push(args);
  try {
    http.request = (url, options, onResponse) => {
      if (url instanceof URL && url.pathname === '/v1/convert') throw Error('request secret');
      return original(url, options, onResponse);
    };
    const first = await request(port, multipart(pdf(100)));
    assert.equal(first.status, 502);
    assert.doesNotMatch(first.body, /secret/);
    http.request = (url, options, onResponse) => {
      if (url instanceof URL && url.pathname === '/v1/convert') {
        const proxy = original(url, options, onResponse);
        proxy.write = () => { throw Error('write secret'); };
        return proxy;
      }
      return original(url, options, onResponse);
    };
    const second = await request(port, multipart(pdf(100)));
    assert.equal(second.status, 502);
    assert.deepEqual(paygate.calls.filter(call => call[0] === 'refundFree').map(call => call.slice(2)),
      [['day-bound-ip', '2026-10-25'], ['day-bound-ip', '2026-10-25']]);
    assert.equal(seen.length, 0);
    assert.doesNotMatch(JSON.stringify(logged), /request secret|write secret/);
  } finally { http.request = original; console.error = priorError; }
});

test('strict multipart rejects trailing bytes after closing delimiter, including file-shaped data', async t => {
  const { port, paygate, seen } = await harness(t);
  const valid = multipart(pdf(100));
  for (const tail of [Buffer.from('EXTRA'), Buffer.from('--incoming\r\nContent-Disposition: form-data; name="file"; filename="second.pdf"\r\n\r\n%PDF-1.7\n\r\n--incoming--\r\n')]) {
    assert.equal((await request(port, Buffer.concat([valid, tail]))).status, 400);
  }
  assert.equal(paygate.calls.length, 0);
  assert.equal(seen.length, 0);
});

test('multipart parser avoids full-file Buffer.concat while retaining a single bounded PDF buffer', async () => {
  const file = pdf(3 * MiB);
  const body = multipart(file);
  const req = Readable.from(Array.from({ length: Math.ceil(body.length / 16384) }, (_, n) => body.subarray(n * 16384, (n + 1) * 16384)));
  req.headers = { 'content-type': 'multipart/form-data; boundary=incoming' };
  const original = Buffer.concat;
  let largestConcatenation = 0;
  Buffer.concat = function (buffers, ...rest) {
    largestConcatenation = Math.max(largestConcatenation, buffers.reduce((sum, chunk) => sum + chunk.length, 0));
    return original.call(this, buffers, ...rest);
  };
  try {
    const parsed = await parsePdf(req);
    assert.deepEqual(parsed, file);
    assert.ok(largestConcatenation < 65536, `full-file concat of ${largestConcatenation} bytes`);
  } finally { Buffer.concat = original; }
});

test('binary PDF with boundary-shaped bytes survives and split multipart delimiters reject trailing data', async t => {
  const { port, paygate, seen } = await harness(t);
  const binary = Buffer.concat([Buffer.from('%PDF-1.7\n\x00\xff\r\n--incominX\r\n'), Buffer.alloc(256, 0xa5)]);
  assert.equal((await request(port, multipart(binary))).status, 200);
  assert.ok(seen[0].body.includes(binary));
  const ambiguous = Buffer.concat([Buffer.from('%PDF-1.7\n\x00\xff\r\n--incoming-X\r\n'), Buffer.alloc(256, 0xa5)]);
  assert.equal((await request(port, multipart(ambiguous))).status, 400);
  const file = multipart(pdf(100));
  for (const extra of [Buffer.concat([file, Buffer.from('TRAILING')]), multipart(pdf(100), { second: true })]) {
    const result = await new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/v1/convert', method: 'POST', headers: {
        origin: 'http://localhost:3000', 'content-type': 'multipart/form-data; boundary=incoming',
        'content-length': extra.length,
      } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject);
      for (let i = 0; i < extra.length; i += 3) req.write(extra.subarray(i, i + 3));
      req.end();
    });
    assert.equal(result, 400);
  }
  assert.deepEqual(paygate.calls.map(call => call[0]), ['free']);
});

test('raw forged Content-Length shorter than multipart cannot bypass parser or consume', async t => {
  const { port, paygate, seen } = await harness(t);
  const body = multipart(pdf(100));
  const response = await new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    const chunks = [];
    socket.setTimeout(1500, () => socket.destroy(Error('raw request timed out')));
    socket.on('connect', () => {
      socket.write(`POST /v1/convert HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: http://localhost:3000\r\nContent-Type: multipart/form-data; boundary=incoming\r\nContent-Length: 40\r\nConnection: close\r\n\r\n`);
      socket.end(body);
    });
    socket.on('data', chunk => chunks.push(chunk));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('latin1')));
    socket.on('error', reject);
  });
  assert.match(response, /^HTTP\/1\.1 400 /);
  assert.equal(paygate.calls.length, 0);
  assert.equal(seen.length, 0);
});

test('browser abort after upstream 200 commits unit without refund', async t => {
  let upstream200, browser200;
  const got200 = new Promise(resolve => { upstream200 = resolve; });
  const gotBrowser200 = new Promise(resolve => { browser200 = resolve; });
  const gate = fakePaygate();
  const { port } = await harness(t, { paygate: gate, upstreamHandler(req, res) {
    res.writeHead(200, { 'content-type': 'text/markdown' });
    res.write('partial');
    upstream200();
  } });
  const req = http.request({ hostname: '127.0.0.1', port, path: '/v1/convert', method: 'POST', headers: {
    origin: 'http://localhost:3000', 'content-type': 'multipart/form-data; boundary=incoming',
  } }, res => { assert.equal(res.statusCode, 200); browser200(); res.destroy(); });
  req.on('error', () => {});
  try {
    req.end(multipart(pdf(100)));
    await got200;
    await gotBrowser200;
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(gate.calls.filter(call => call[0].startsWith('refund')).length, 0);
  } finally { req.destroy(); }
});

test('exactly 10 MiB file remains paid-eligible without an extra allocation', async t => {
  const { port, paygate, seen } = await harness(t);
  const result = await request(port, multipart(pdf(10 * MiB)));
  assert.equal(result.status, 200);
  assert.deepEqual(paygate.calls.map(call => call[0]), ['paid']);
  assert.equal(seen.length, 1);
});

test('configured startup rejects invalid API_TOKEN before constructing a paygate client', async () => {
  const secrets = [
    '9b6f38e4a1d20c7f5e83b49a6d1f072c8e35b9a4f60d217ce98b543af106d82e',
    '71e5a92b4c03f8d65a1b7e90c2d43f6a8b5e197c04d2a63f9b0e85c71d4a2f36',
    '84d31f7a9b20c56e1d48f3a70b25e69c4f18d03a72b56e91c8a4f0d37b26e59a',
  ];
  const env = { API_TOKEN: 'bad\nheader', PAYGATE_DATABASE_URL: 'postgresql://paygate_pdf2md:password@127.0.0.1:5433/paygate',
    PAYGATE_IP_SECRET: secrets[0], PAYGATE_CODE_SECRET: secrets[1], PAYGATE_COOKIE_SECRET: secrets[2],
    STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_test', STRIPE_PRICE_ID: 'price_test',
    PUBLIC_BASE_URL: 'https://pdf.example.test', TRUSTED_PROXY_IP: '192.0.2.8' };
  await assert.rejects(createConfiguredServer(env, { paygateFactory: () => { throw Error('client constructed'); } }), /API_TOKEN/);
});

test('server refuses missing secret at startup', () => {
  assert.throws(() => createServer({ token: '', apiUrl: 'http://127.0.0.1:8000', buildDir: __dirname }), /API_TOKEN/);
});

const donationSession = { id: 'cs_test_123abc', mode: 'payment', currency: 'eur', amount_total: 500, metadata: { donation_context: 'pdf_to_markdown' }, status: 'complete', payment_status: 'paid' };
async function withDonationServer(t, stripeFetch, { enabled = true, stripeSecretKey = 'sk_test_123abc' } = {}) {
  const server = createServer({ token: 'private-only', apiUrl: 'http://127.0.0.1:8000', buildDir: __dirname,
    testMode: true, paygate: fakePaygate(), publicBaseUrl: 'https://pdf.example.test', testCraOrigin: 'http://localhost:3000',
    cookieSecret: 'test-cookie-secret-which-is-never-live', trustedProxyIp: '192.0.2.8',
    donationsEnabled: enabled, stripeSecretKey, donationFetch: stripeFetch });
  const port = await listen(server);
  t.after(() => close(server));
  return `http://127.0.0.1:${port}`;
}
async function donationRequest(base, route, method, origin, body, contentType = 'application/json') {
  const headers = {};
  if (origin !== null) headers.Origin = origin;
  if (body !== undefined) headers['Content-Type'] = contentType;
  const response = await fetch(`${base}${route}`, { method, headers, ...(body === undefined ? {} : { body }) });
  return { response, data: await response.json() };
}
function privacy(response, allow) {
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  if (allow) assert.equal(response.headers.get('allow'), allow);
}
const stripeOk = calls => async (...args) => { calls.push(args); return Response.json({ url: 'https://checkout.stripe.com/c/pay/test123' }); };

test('donation checkout uses the configured public origin, not request Host, and returns only URL', async t => {
  const calls = [];
  const base = await withDonationServer(t, stripeOk(calls));
  const { response, data } = await donationRequest(base, '/api/donate', 'POST', 'https://pdf.example.test', '{"amountCents":500,"locale":"en"}');
  assert.equal(response.status, 201);
  assert.deepEqual(data, { url: 'https://checkout.stripe.com/c/pay/test123' });
  privacy(response);
  const form = new URLSearchParams(calls[0][1].body);
  assert.equal(form.get('success_url'), 'https://pdf.example.test/?donation=success&session_id={CHECKOUT_SESSION_ID}');
  assert.equal(form.get('cancel_url'), 'https://pdf.example.test/?donation=cancel');
  assert.equal(form.get('metadata[donation_context]'), 'pdf_to_markdown');
  assert.equal(form.get('metadata[app]'), null);
});

test('donation checkout rejects absent and mismatched origins without contacting Stripe', async t => {
  const calls = [];
  const base = await withDonationServer(t, stripeOk(calls));
  for (const origin of [null, 'http://localhost:3001', 'https://evil.example', 'https://pdf.example.test/']) {
    const { response } = await donationRequest(base, '/api/donate', 'POST', origin, '{"amountCents":500,"locale":"de"}');
    assert.equal(response.status, 403);
    privacy(response);
  }
  assert.equal(calls.length, 0);
  const { response } = await donationRequest(base, '/api/donate', 'POST', 'http://localhost:3000', '{"amountCents":500,"locale":"de"}');
  assert.equal(response.status, 201);
  assert.equal(new URLSearchParams(calls[0][1].body).get('cancel_url'), 'http://localhost:3000/?donation=cancel');
});

test('donation checkout rejects malformed and oversize bodies without contacting Stripe', async t => {
  const calls = [];
  const base = await withDonationServer(t, stripeOk(calls));
  for (const [body, type] of [['{'], ['{"amountCents":500,"locale":"de","url":"evil"}'], ['x'.repeat(2048)], ['{"amountCents":500,"locale":"de"}', 'text/plain'], ['{"amountCents":499,"locale":"de"}']]) {
    const { response } = await donationRequest(base, '/api/donate', 'POST', 'https://pdf.example.test', body, type);
    assert.equal(response.status, 400);
    privacy(response);
  }
  assert.equal(calls.length, 0);
});

test('donations are off unless explicitly enabled with a key, and upstream failures are redacted', async t => {
  for (const options of [{ enabled: false }, { stripeSecretKey: '' }]) {
    const base = await withDonationServer(t, async () => { throw Error('should not call'); }, options);
    for (const [route, method, body] of [['/api/donate', 'POST', '{"amountCents":500,"locale":"de"}'], ['/api/donate/status?session_id=cs_test_123abc', 'GET']]) {
      const { response } = await donationRequest(base, route, method, 'https://pdf.example.test', body);
      assert.equal(response.status, 503);
    }
  }
  const base = await withDonationServer(t, async () => new Response('Stripe secret error sk_test_123abc', { status: 500 }));
  const { response, data } = await donationRequest(base, '/api/donate', 'POST', 'https://pdf.example.test', '{"amountCents":500,"locale":"de"}');
  assert.equal(response.status, 502);
  assert.doesNotMatch(JSON.stringify(data), /Stripe secret|sk_test/i);
});

test('donation status returns paid/processing and rejects malformed IDs and extra params', async t => {
  let session = donationSession;
  const base = await withDonationServer(t, async () => Response.json(session));
  for (const [payment, expected] of [['paid', 'paid'], ['unpaid', 'processing']]) {
    session = { ...donationSession, payment_status: payment };
    const { response, data } = await donationRequest(base, '/api/donate/status?session_id=cs_test_123abc', 'GET', null);
    assert.equal(response.status, 200);
    assert.deepEqual(data, { status: expected });
    privacy(response);
  }
  session = { ...donationSession, metadata: { app: 'pdf2md', sku: 'pass50' } };
  assert.deepEqual((await donationRequest(base, '/api/donate/status?session_id=cs_test_123abc', 'GET', null)).data, { status: 'not_found' });
  for (const query of ['session_id=bad', 'session_id=cs_test_1&session_id=cs_test_2', 'session_id=cs_test_123abc&x=1']) {
    const { response } = await donationRequest(base, `/api/donate/status?${query}`, 'GET', null);
    assert.equal(response.status, 400);
  }
});

test('donation routes reject OPTIONS and unsupported methods with Allow', async t => {
  const base = await withDonationServer(t, async () => { throw Error('should not call'); });
  for (const [route, method, allow] of [['/api/donate', 'OPTIONS', 'POST'], ['/api/donate', 'GET', 'POST'], ['/api/donate/status', 'OPTIONS', 'GET'], ['/api/donate/status', 'POST', 'GET']]) {
    const { response } = await donationRequest(base, route, method, null, method === 'POST' ? '{}' : undefined);
    assert.equal(response.status, 405);
    privacy(response, allow);
  }
});

test('donation checkout is rate limited per client', async t => {
  const calls = [];
  const base = await withDonationServer(t, stripeOk(calls));
  const statuses = [];
  for (let i = 0; i < 11; i++) statuses.push((await donationRequest(base, '/api/donate', 'POST', 'https://pdf.example.test', '{"amountCents":500,"locale":"de"}')).response.status);
  assert.deepEqual(statuses, [...Array(10).fill(201), 429]);
  assert.equal(calls.length, 10);
});

test('donation fetch override is refused outside test mode', () => {
  assert.throws(() => createServer({ token: 'private-only', apiUrl: 'http://127.0.0.1:8000', buildDir: __dirname, paygate: fakePaygate(),
    publicBaseUrl: 'https://pdf.example.test', cookieSecret: 'x', trustedProxyIp: '192.0.2.8', donationFetch: fetch }), /override refused/);
});
