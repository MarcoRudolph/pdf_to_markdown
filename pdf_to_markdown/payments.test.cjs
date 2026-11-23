const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, createHmac } = require('node:crypto');
const { createServer } = require('./server.cjs');
const { createPayments } = require('./payments.cjs');
const secret = 'test-code-secret-with-more-than-32-bytes';
const base = 'https://pdf.example.test';
const subject = 'a'.repeat(64);
const paid = { id: 'cs_paid_1', payment_status: 'paid', client_reference_id: subject, metadata: { app: 'pdf2md', sku: 'pass50', subject_hash: subject } };
function fixture() {
  const calls = [], refs = [], redeems = [];
  let session = paid, fulfilled = true;
  const stripe = { checkout: { sessions: {
    async create(args) { calls.push(args); session = { ...paid, client_reference_id: args.client_reference_id, metadata: args.metadata }; return { url: 'https://checkout.stripe.test/session' }; },
    async retrieve(ref) { refs.push(ref); return session; },
  } } };
  const paygate = {
    async checkoutFulfilled(ref, buyer) { assert.equal(ref, session.id); assert.equal(buyer, session.client_reference_id); return fulfilled; },
    async redeemEntitlement(hash, buyer) { redeems.push([hash, buyer]); return hash === createHash('sha256').update('purchase-one').digest('hex') ? 1 : 0; },
  };
  return { stripe, paygate, calls, refs, redeems, setSession(value) { session = value; }, setFulfilled(value) { fulfilled = value; } };
}
function payments(f) { return createPayments({ stripe: f.stripe, paygate: f.paygate, stripePriceId: 'price_fixed', publicBaseUrl: base, codeSecret: secret }); }
test('checkout fixes server-side price and binds only subject hash, never client secrets', async () => {
  const f = fixture();
  assert.deepEqual(await payments(f).checkout(subject), { url: 'https://checkout.stripe.test/session' });
  assert.deepEqual(f.calls, [{ mode: 'payment', line_items: [{ price: 'price_fixed', quantity: 1 }],
    success_url: base + '/?session_id={CHECKOUT_SESSION_ID}', cancel_url: base + '/',
    client_reference_id: subject, metadata: { app: 'pdf2md', sku: 'pass50', subject_hash: subject },
    payment_intent_data: { metadata: { app: 'pdf2md', sku: 'pass50' } } }]);
  assert.doesNotMatch(JSON.stringify(f.calls), /cookie|192\.0\.2|restore|code|amount/);
});
test('paid status requires exact buyer-bound DB lookup and deterministic code; never fulfills from polling', async () => {
  const f = fixture(), p = payments(f);
  const code = createHmac('sha256', secret).update('pdf2md|' + paid.id, 'utf8').digest('base64url');
  assert.deepEqual(await p.status(paid.id, subject), { status: 'ready', restore_code: code });
  assert.deepEqual(await p.status(paid.id, subject), { status: 'ready', restore_code: code });
  assert.deepEqual(f.refs, [paid.id, paid.id]);
  assert.match(p.codeHash(code), /^[0-9a-f]{64}$/);
  assert.equal(p.codeHash(code), createHash('sha256').update(code, 'utf8').digest('hex'));
  f.setFulfilled(false);
  assert.deepEqual(await p.status(paid.id, subject), { status: 'pending' });
});
test('unpaid, mismatched and unrelated Stripe sessions never expose restore code or query DB', async () => {
  const f = fixture(), p = payments(f);
  for (const change of [{ ...paid, payment_status: 'unpaid' }, { ...paid, client_reference_id: 'b'.repeat(64) },
    { ...paid, metadata: { ...paid.metadata, sku: 'other' } }, { ...paid, metadata: { ...paid.metadata, subject_hash: 'b'.repeat(64) } },
    { ...paid, metadata: { ...paid.metadata, app: 'other' } }, { ...paid, id: 'cs_other' }]) {
    f.setSession(change);
    assert.deepEqual(await p.status(paid.id, subject), { status: 'pending' });
  }
});
test('redeem hashes input, delegates one-purchase ownership and flattens invalid/capped results', async () => {
  const f = fixture(), p = payments(f);
  assert.deepEqual(await p.redeem('purchase-one', subject), { passes: 1 });
  assert.deepEqual(await p.redeem('another-purchase', subject), { passes: 0 });
  assert.deepEqual(f.redeems, [
    [createHash('sha256').update('purchase-one').digest('hex'), subject],
    [createHash('sha256').update('another-purchase').digest('hex'), subject],
  ]);
});
test('a code redeems only its purchase, not a second purchase sharing the buyer email', async () => {
  const f = fixture(), p = payments(f);
  const first = p.restoreCode('cs_paid_1'), second = p.restoreCode('cs_paid_2');
  const firstHash = p.codeHash(first), secondHash = p.codeHash(second);
  const ownership = new Map([[firstHash, new Set()], [secondHash, new Set()]]);
  f.paygate.redeemEntitlement = async (hash, buyer) => {
    if (!ownership.has(hash)) return 0;
    ownership.get(hash).add(buyer);
    return 1;
  };
  const newDevice = 'b'.repeat(64);
  assert.deepEqual(await p.redeem(first, newDevice), { passes: 1 });
  assert.deepEqual([...ownership.get(firstHash)], [newDevice]);
  assert.equal(ownership.get(secondHash).has(newDevice), false);
  assert.deepEqual(await p.redeem(second, newDevice), { passes: 1 });
  assert.equal(ownership.get(secondHash).has(newDevice), true);
  // Task 5 must pass these hashes to fulfillGuarded after signature verification.
});
async function harness(t, overrides = {}) {
  const f = fixture(); Object.assign(f.stripe.checkout.sessions, overrides.stripe || {});
  Object.assign(f.paygate, overrides.paygate || {});
  const server = createServer({ token: 'token', apiUrl: 'http://127.0.0.1:8000', buildDir: __dirname,
    paygate: f.paygate, stripe: f.stripe, stripePriceId: 'price_fixed', publicBaseUrl: base, codeSecret: secret,
    cookieSecret: 'test-cookie-secret', trustedProxyIp: '192.0.2.8' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}`;
  async function request(route, { body, cookie, origin = base, method = body === undefined ? 'GET' : 'POST' } = {}) {
    const response = await fetch(root + route, { method, headers: { ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.text(), headers: response.headers };
  }
  return { f, request };
}
test('HTTP checkout refuses client price/sku/amount and sets no-referrer', async t => {
  const { f, request } = await harness(t);
  const good = await request('/v1/checkout', { body: {} });
  assert.equal(good.status, 200); assert.equal(good.headers.get('referrer-policy'), 'no-referrer');
  assert.deepEqual(JSON.parse(good.body), { url: 'https://checkout.stripe.test/session' });
  for (const body of [{ price: 'price_attacker' }, { amount: 1 }, { sku: 'other' }])
    assert.equal((await request('/v1/checkout', { body })).status, 400);
  assert.equal(f.calls.length, 1);
});
test('HTTP status binds cookie buyer, returns only status/code and keeps pending on wrong buyer', async t => {
  const { request } = await harness(t);
  const first = await request('/v1/checkout', { body: {} });
  const cookie = first.headers.get('set-cookie').split(';')[0];
  const ready = await request('/v1/checkout-status?session_id=cs_paid_1', { cookie });
  assert.equal(ready.status, 200); assert.deepEqual(Object.keys(JSON.parse(ready.body)).sort(), ['restore_code', 'status']);
  assert.equal(JSON.parse(ready.body).status, 'ready');
  const other = await request('/v1/checkout-status?session_id=cs_paid_1');
  assert.deepEqual(JSON.parse(other.body), { status: 'pending' });
  assert.equal(other.headers.get('referrer-policy'), 'no-referrer');
});
test('HTTP invalid/oversized redeem 400, burst 429, Stripe outage 503 redacted', async t => {
  const { f, request } = await harness(t);
  assert.equal((await request('/v1/redeem', { body: { code: '' } })).status, 400);
  assert.equal((await request('/v1/redeem', { body: { code: 'x'.repeat(129) } })).status, 400);
  const first = await request('/v1/checkout', { body: {} });
  const cookie = first.headers.get('set-cookie').split(';')[0];
  let limited;
  for (let n = 0; n < 30; n++) {
    limited = await request('/v1/redeem', { body: { code: 'missing' }, cookie });
    if (limited.status === 429) break;
  }
  assert.equal(limited.status, 429);
  f.stripe.checkout.sessions.create = async () => { throw Error('Stripe private credentials'); };
  const error = await request('/v1/checkout', { body: {} });
  assert.equal(error.status, 503); assert.doesNotMatch(error.body, /private|credentials/);
});
