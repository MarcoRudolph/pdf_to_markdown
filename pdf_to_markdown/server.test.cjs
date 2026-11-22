const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createServer } = require('./server.cjs');

function listen(server) { return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port))); }
async function request(port, body, contentType = 'multipart/form-data; boundary=x') {
  const response = await fetch(`http://127.0.0.1:${port}/v1/convert`, { method: 'POST', headers: { 'content-type': contentType }, body });
  return { status: response.status, body: await response.text(), disposition: response.headers.get('content-disposition') };
}

test('proxy forwards body with server-only bearer, returns markdown, redacts failures and rejects oversize', async () => {
  let auth, seenBody, fail = false;
  const upstream = http.createServer((req, res) => {
    auth = req.headers.authorization;
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      seenBody = Buffer.concat(chunks).toString();
      res.writeHead(fail ? 500 : 200, { 'content-type': 'text/markdown', 'content-disposition': 'attachment; filename="document.md"' });
      res.end(fail ? 'INTERNAL SECRET' : '# Real text');
    });
  });
  const upstreamPort = await listen(upstream);
  const server = createServer({ token: 'private-only', apiUrl: `http://127.0.0.1:${upstreamPort}`, buildDir: __dirname });
  const port = await listen(server);
  try {
    let result = await request(port, 'PDF contents');
    assert.equal(result.status, 200);
    assert.equal(result.body, '# Real text');
    assert.equal(result.disposition, 'attachment; filename="document.md"');
    assert.equal(auth, 'Bearer private-only');
    assert.equal(seenBody, 'PDF contents');
    fail = true;
    result = await request(port, 'PDF contents');
    assert.equal(result.status, 502);
    assert.doesNotMatch(result.body, /SECRET/);
    result = await request(port, Buffer.alloc(10485760 + 65537));
    assert.equal(result.status, 413);
    result = await request(port, 'wrong', 'text/plain');
    assert.equal(result.status, 400);
  } finally { server.close(); upstream.close(); }
});

test('server refuses missing secret at startup', () => {
  assert.throws(() => createServer({ token: '', apiUrl: 'http://127.0.0.1:8000', buildDir: __dirname }), /API_TOKEN/);
});

const donationSession = { id: 'cs_test_123abc', mode: 'payment', currency: 'eur', amount_total: 500, metadata: { donation_context: 'pdf_to_markdown' }, status: 'complete', payment_status: 'paid' };
async function withDonationServer(origin, stripeFetch, fn, stripeKey = 'sk_test_123abc') {
  const server = createServer({ token: 'private-only', apiUrl: 'http://127.0.0.1:8000', buildDir: __dirname, stripeKey, donationOrigin: origin, stripeFetch });
  const port = await listen(server);
  try { await fn(`http://127.0.0.1:${port}`); } finally { await new Promise(resolve => server.close(resolve)); }
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

test('Node checkout uses configured CRA origin, not request Host, and returns only URL', async () => {
  const calls = [];
  await withDonationServer('http://localhost:3000', async (...args) => { calls.push(args); return Response.json({ url: 'https://checkout.stripe.com/c/pay/test123' }); }, async base => {
    const { response, data } = await donationRequest(base, '/api/donate', 'POST', 'http://localhost:3000', '{"amountCents":500,"locale":"en"}');
    assert.equal(response.status, 201);
    assert.deepEqual(data, { url: 'https://checkout.stripe.com/c/pay/test123' });
    privacy(response);
    const form = new URLSearchParams(calls[0][1].body);
    assert.equal(form.get('success_url'), 'http://localhost:3000/?donation=success&session_id={CHECKOUT_SESSION_ID}');
    assert.equal(form.get('cancel_url'), 'http://localhost:3000/?donation=cancel');
  });
});

test('Node exact direct origin rejects absent and mismatched origins', async () => {
  let calls = 0;
  await withDonationServer('http://127.0.0.1:3001', async () => { calls++; return Response.json({ url: 'https://checkout.stripe.com/c/pay/test123' }); }, async base => {
    for (const origin of [null, 'http://localhost:3000', 'http://localhost:3001']) {
      const { response } = await donationRequest(base, '/api/donate', 'POST', origin, '{"amountCents":500,"locale":"de"}');
      assert.equal(response.status, 403);
      privacy(response);
    }
    const { response } = await donationRequest(base, '/api/donate', 'POST', 'http://127.0.0.1:3001', '{"amountCents":500,"locale":"de"}');
    assert.equal(response.status, 201);
    assert.equal(calls, 1);
  });
});

test('Node checkout rejects malformed and oversize bodies without contacting Stripe', async () => {
  let calls = 0;
  await withDonationServer('http://localhost:3000', async () => { calls++; return Response.json({ url: 'https://checkout.stripe.com/c/pay/test123' }); }, async base => {
    for (const [body, status, type] of [['{', 400], ['{"amountCents":500,"locale":"de","url":"evil"}', 400], ['x'.repeat(2048), 413], ['{"amountCents":500,"locale":"de"}', 400, 'text/plain']]) {
      const { response } = await donationRequest(base, '/api/donate', 'POST', 'http://localhost:3000', body, type);
      assert.equal(response.status, status);
      privacy(response);
    }
    assert.equal(calls, 0);
  });
});

test('Node checkout handles absent configuration and redacts upstream failure', async () => {
  await withDonationServer('', async () => { throw Error('should not call'); }, async base => {
    const { response } = await donationRequest(base, '/api/donate', 'POST', 'http://localhost:3000', '{"amountCents":500,"locale":"de"}');
    assert.equal(response.status, 503);
  });
  await withDonationServer('http://localhost:3000', async () => { throw Error('should not call'); }, async base => {
    const { response } = await donationRequest(base, '/api/donate', 'POST', 'http://localhost:3000', '{"amountCents":500,"locale":"de"}');
    assert.equal(response.status, 503);
  }, '');
  await withDonationServer('http://localhost:3000', async () => new Response('Stripe secret error', { status: 500 }), async base => {
    const { response, data } = await donationRequest(base, '/api/donate', 'POST', 'http://localhost:3000', '{"amountCents":500,"locale":"de"}');
    assert.equal(response.status, 502);
    assert.doesNotMatch(JSON.stringify(data), /Stripe secret|sk_test/i);
  });
});

test('Node status returns paid, processing and rejects malformed IDs', async () => {
  let session = donationSession;
  await withDonationServer('http://localhost:3000', async () => Response.json(session), async base => {
    for (const [payment, expected] of [['paid', 'paid'], ['unpaid', 'processing']]) {
      session = { ...donationSession, payment_status: payment };
      const { response, data } = await donationRequest(base, '/api/donate/status?session_id=cs_test_123abc', 'GET', null);
      assert.equal(response.status, 200);
      assert.deepEqual(data, { status: expected });
      privacy(response);
    }
    const { response } = await donationRequest(base, '/api/donate/status?session_id=bad', 'GET', null);
    assert.equal(response.status, 400);
  });
});

test('Node donation routes reject OPTIONS and unsupported methods with Allow', async () => {
  await withDonationServer('http://localhost:3000', async () => { throw Error('should not call'); }, async base => {
    for (const [route, method, allow] of [['/api/donate', 'OPTIONS', 'POST'], ['/api/donate', 'GET', 'POST'], ['/api/donate/status', 'OPTIONS', 'GET'], ['/api/donate/status', 'POST', 'GET']]) {
      const { response } = await donationRequest(base, route, method, null, method === 'POST' ? '{}' : undefined);
      assert.equal(response.status, 405);
      privacy(response, allow);
    }
  });
});
