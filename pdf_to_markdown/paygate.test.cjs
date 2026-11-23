const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { createPaygate } = require('./paygate.cjs');
const { createConfiguredServer } = require('./server.cjs');
const subject = 'a'.repeat(64), code = 'b'.repeat(64);
const ipSecret = '9b6f38e4a1d20c7f5e83b49a6d1f072c8e35b9a4f60d217ce98b543af106d82e';
const codeSecret = '71e5a92b4c03f8d65a1b7e90c2d43f6a8b5e197c04d2a63f9b0e85c71d4a2f36';
const cookieSecret = '84d31f7a9b20c56e1d48f3a70b25e69c4f18d03a72b56e91c8a4f0d37b26e59a';
function fakePool(responses) {
  const calls = [];
  const client = {
    async query(text, values) { const query = typeof text === 'string' ? { text, values } : text; calls.push(query); const answer = responses.shift(); if (answer instanceof Error) throw answer; return answer || { rows: [] }; },
    release() { calls.push({ release: true }); },
  };
  return { calls, pool: { async connect() { return client; }, query: (...args) => client.query(...args), async end() {} } };
}
function config() { return {
  API_TOKEN: 'token', API_URL: 'http://127.0.0.1:8000',
  PAYGATE_DATABASE_URL: 'postgresql://paygate_pdf2md:masked@127.0.0.1:5433/paygate',
  PAYGATE_IP_SECRET: ipSecret, PAYGATE_CODE_SECRET: codeSecret,
  PAYGATE_COOKIE_SECRET: cookieSecret,
  STRIPE_SECRET_KEY: 'sk_test_placeholder', STRIPE_WEBHOOK_SECRET: 'whsec_placeholder',
  STRIPE_PRICE_ID: 'price_test_placeholder', PUBLIC_BASE_URL: 'https://example.org',
  TRUSTED_PROXY_IP: '127.0.0.1',
}; }
const seeded = { role: 'paygate_pdf2md', app_active: true, timezone: 'Europe/Berlin', free_units_per_day: 5, free_units_per_day_ip: 15, free_limits: { max_file_bytes: 1048576 }, product_active: true, amount_cents: 200, currency: 'eur', units: 50, quota_period: 'day', valid_days: 30, limits: { max_file_bytes: 10485760 }, stripe_price_id: 'price_test_placeholder' };

test('quota pins Berlin day and hashes IP only in parameters on the same transaction', async () => {
  const day = '2026-11-22', ip = '192.0.2.14';
  const f = fakePool([{ rows: [] }, { rows: [{ day }] }, { rows: [{ quota: { free: { units_left: 5 }, paid: [] } }] }, { rows: [] }]);
  const result = await createPaygate({ databaseUrl: 'unused', ipSecret, pool: f.pool }).quota(subject, ip);
  assert.equal(result.day, day);
  assert.equal(result.free.units_left, 5);
  assert.match(f.calls[1].text, /Europe\/Berlin/);
  assert.match(f.calls[2].text, /select paygate\.quota\(\$1,\$2,\$3\)/i);
  assert.deepEqual(f.calls[2].values, ['pdf2md', subject, createHmac('sha256', ipSecret).update(ip + '|' + day).digest('hex')]);
  assert.equal(f.calls[0].text, 'BEGIN');
  assert.equal(f.calls[3].text, 'COMMIT');
  assert.ok(f.calls.some(c => c.release));
});

test('reservePaid returns selected day and consumed entitlement or null', async () => {
  for (const consumption of [{ entitlement_id: 'ent-1', units_left: 49 }, null]) {
    const f = fakePool([{ rows: [] }, { rows: [{ day: '2026-11-22' }] }, { rows: [{ consumed: consumption }] }, { rows: [] }]);
    const got = await createPaygate({ databaseUrl: 'unused', ipSecret, pool: f.pool }).reservePaid(subject);
    assert.deepEqual(got, consumption ? { day: '2026-11-22', ...consumption } : null);
    assert.match(f.calls[2].text, /paygate\.consume_paid\(\$1,\$2\)/);
    assert.deepEqual(f.calls[2].values, ['pdf2md', subject]);
  }
});

test('malicious hash remains only in bound values and DB errors roll back', async () => {
  const malicious = "'; drop table paygate.apps; --";
  const f = fakePool([{ rows: [] }, { rows: [{ day: '2026-11-22' }] }, new Error('offline'), { rows: [] }]);
  await assert.rejects(createPaygate({ databaseUrl: 'unused', ipSecret, pool: f.pool }).reserveFree(malicious, '192.0.2.14'), /offline/);
  assert.ok(f.calls.some(c => c.text === 'ROLLBACK'));
  assert.ok(f.calls.every(c => !c.text?.includes(malicious)));
  assert.ok(f.calls.some(c => c.values?.includes(malicious)));
});

test('free reservation retains IP hash/day and refuses refund after midnight', async () => {
  const f = fakePool([{ rows: [] }, { rows: [{ day: '2026-11-22' }] }, { rows: [{ consumed: true }] }, { rows: [] },
    { rows: [] }, { rows: [{ day: '2026-11-23' }] }, { rows: [] }]);
  const gate = createPaygate({ databaseUrl: 'unused', ipSecret, pool: f.pool });
  const reserved = await gate.reserveFree(subject, '192.0.2.14');
  assert.equal(reserved.day, '2026-11-22');
  assert.equal(reserved.units, 1);
  assert.match(reserved.ipHash, /^[0-9a-f]{64}$/);
  await assert.rejects(gate.refundFreeDay(subject, reserved.ipHash, reserved.day), /day changed/);
  assert.ok(!f.calls.some(c => c.text?.includes('paygate.refund_free')));
});

test('write adapters call only granted functions with bound values and unsupported reads fail closed', async () => {
  const f = fakePool([{ rows: [{ entitlement_id: 'ent-1' }] }, { rows: [{ reversed: true }] }, { rows: [{ redeemed: 2 }] }]);
  const gate = createPaygate({ databaseUrl: 'unused', ipSecret, pool: f.pool });
  assert.equal(await gate.fulfillGuarded({ sku: 'pass50', amountCents: 200, currency: 'eur', codeHash: code, ref: 'cs_1', email: 'buyer@example.org', subjectHash: subject }), 'ent-1');
  assert.equal(await gate.recordReversal('pi_1', 'disputed'), true);
  assert.equal(await gate.redeemEntitlement(code, subject), 2);
  assert.match(f.calls[0].text, /paygate.fulfill_purchase/);
  assert.deepEqual(f.calls[0].values.slice(0, 4), ['pdf2md', 'pass50', 'buyer@example.org', 'cs_1']);
  assert.deepEqual(f.calls[1].values, ['pi_1', 'disputed']);
  assert.deepEqual(f.calls[2].values, ['pdf2md', code, subject]);
  await assert.rejects(gate.checkoutFulfilled('cs_1', subject), /unavailable/);
  await assert.rejects(gate.recordAnomaly(code, 'unknown'), /unavailable/);
});

test('startup refuses missing and unsafe server-only configuration', async () => {
  const bad = [
    ['PAYGATE_DATABASE_URL', ''], ['PAYGATE_DATABASE_URL', 'postgresql://postgres:masked@localhost/paygate'],
    ['PAYGATE_IP_SECRET', ''], ['PAYGATE_CODE_SECRET', ''], ['PAYGATE_COOKIE_SECRET', ''],
    ['PAYGATE_IP_SECRET', 'weak'], ['PAYGATE_IP_SECRET', '01234567'.repeat(8)], ['PAYGATE_CODE_SECRET', ipSecret],
    ['STRIPE_SECRET_KEY', ''], ['STRIPE_WEBHOOK_SECRET', ''], ['STRIPE_PRICE_ID', ''],
    ['PUBLIC_BASE_URL', 'http://example.org'], ['PUBLIC_BASE_URL', 'not a url'], ['TRUSTED_PROXY_IP', ''],
  ];
  for (const [key, value] of bad) {
    await assert.rejects(createConfiguredServer({ ...config(), [key]: value }, { paygateFactory: () => { throw new Error('must validate before connect'); } }), new RegExp(key));
  }
});

test('startup rejects wrong current_user, missing product config and connection failures', async () => {
  for (const response of [{ ...seeded, role: 'paygate_app' }, { ...seeded, amount_cents: 201 }, new Error('offline')]) {
    let closed = false;
    const gate = { async verifyStartup() { if (response instanceof Error) throw response; return response; }, async close() { closed = true; } };
    await assert.rejects(createConfiguredServer(config(), { paygateFactory: () => gate, stripeFactory: () => ({}) }), /paygate|offline/i);
    assert.equal(closed, true);
  }
});

test('server cannot run without paygate outside explicit test mode', () => {
  assert.throws(() => require('./server.cjs').createServer({ token: 'token', apiUrl: 'http://127.0.0.1:8000', buildDir: __dirname }), /paygate/);
});

test('production adapter refuses conversion until quota routing is installed', async () => {
  const server = require('./server.cjs').createServer({ token: 'token', apiUrl: 'http://127.0.0.1:8000', buildDir: __dirname, paygate: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/convert`, { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: 'PDF' });
    assert.equal(response.status, 503);
  } finally { server.close(); }
});

test('startup verifies DB role and product via parameterized read, then accepts matching config', async () => {
  const f = fakePool([{ rows: [seeded] }]);
  const gate = createPaygate({ databaseUrl: 'unused', ipSecret, pool: f.pool });
  const server = await createConfiguredServer(config(), { paygateFactory: () => gate, stripeFactory: () => ({}) });
  assert.deepEqual(f.calls[0].values, ['pdf2md', 'pass50']);
  assert.match(f.calls[0].text, /current_user/);
  server.close();
});
