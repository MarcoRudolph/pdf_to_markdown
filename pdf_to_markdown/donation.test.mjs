import test from 'node:test';
import assert from 'node:assert/strict';
import { createDonationCheckout, getDonationStatus, DonationError } from './donation.mjs';

const key = 'sk_test_localOnly';
const checkoutUrl = 'https://checkout.stripe.com/c/pay/test';
const base = { amountCents: 1000, locale: 'en', origin: 'https://example.org/', stripeKey: key };
const sessionId = 'cs_test_ABC123';
const session = { id: sessionId, mode: 'payment', currency: 'eur', amount_total: 1000,
  metadata: { donation_context: 'pdf_to_markdown' }, status: 'complete', payment_status: 'paid',
  customer: { email: 'private@example.org' } };
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status,
  json: async () => body });
const mustNotFetch = () => { throw new Error('unexpected provider call'); };
const isError = status => error => error instanceof DonationError && error.status === status;

for (const amountCents of [500, 1000, 50000]) {
  test(`accepts permitted amount ${amountCents} and sends exact Stripe contract`, async () => {
    let calls = 0;
    const result = await createDonationCheckout({ ...base, amountCents, fetchImpl: async (url, init) => {
      calls++;
      assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, `Bearer ${key}`);
      assert.equal(init.headers['Content-Type'], 'application/x-www-form-urlencoded');
      assert.equal(init.signal instanceof AbortSignal, true);
      const form = new URLSearchParams(init.body);
      assert.equal(form.get('mode'), 'payment');
      assert.equal(form.get('locale'), 'en');
      assert.equal(form.get('metadata[donation_context]'), 'pdf_to_markdown');
      assert.equal(form.get('line_items[0][price_data][currency]'), 'eur');
      assert.equal(form.get('line_items[0][price_data][unit_amount]'), String(amountCents));
      assert.equal(form.get('line_items[0][price_data][product_data][name]'), 'Voluntary support for Marco Rudolph');
      assert.equal(form.get('line_items[0][quantity]'), '1');
      assert.equal(form.get('success_url'), 'https://example.org/?donation=success&session_id={CHECKOUT_SESSION_ID}');
      assert.equal(form.get('cancel_url'), 'https://example.org/?donation=cancel');
      assert.equal(form.has('client_reference_id'), false);
      assert.equal(form.has('payment_method_types[0]'), false);
      assert.equal(init.headers['Stripe-Version'], undefined);
      return response({ url: checkoutUrl });
    } });
    assert.deepEqual(result, { url: checkoutUrl });
    assert.equal(calls, 1);
  });
}

for (const amountCents of [0, 499, 501, 50001, '1000', NaN, 500.5, Infinity]) {
  test(`rejects invalid amount ${String(amountCents)} without provider call`, async () => {
    await assert.rejects(createDonationCheckout({ ...base, amountCents, fetchImpl: mustNotFetch }), isError(400));
  });
}
for (const changes of [
  { locale: 'fr' }, { locale: 'EN' }, { origin: 'https://example.org/path' },
  { origin: 'http://example.org' }, { origin: 'http://example.org:443' }, { origin: 'not-a-url' },
  { origin: 'https://example.org:443/path' }, { origin: 'https://example.org/?x=1' },
  { origin: 'https://user:pass@example.org' }, { origin: 'https://user:pass@example.org:443' },
  { currency: 'usd' },
]) {
  test(`rejects untrusted checkout input ${JSON.stringify(changes)}`, async () => {
    await assert.rejects(createDonationCheckout({ ...base, ...changes, fetchImpl: mustNotFetch }), isError(400));
  });
}
for (const origin of ['https://example.org:443', 'https://example.org:443/']) {
  test(`normalizes explicit default HTTPS port in origin ${origin}`, async () => {
    const result = await createDonationCheckout({ ...base, origin, fetchImpl: async (_, init) => {
      const form = new URLSearchParams(init.body);
      assert.equal(form.get('success_url'), 'https://example.org/?donation=success&session_id={CHECKOUT_SESSION_ID}');
      assert.equal(form.get('cancel_url'), 'https://example.org/?donation=cancel');
      return response({ url: checkoutUrl });
    } });
    assert.deepEqual(result, { url: checkoutUrl });
  });
}
test('permits explicitly loopback HTTP origin', async () => {
  await createDonationCheckout({ ...base, origin: 'http://127.0.0.1:3000/', fetchImpl: async (_, init) => {
    assert.equal(new URLSearchParams(init.body).get('cancel_url'), 'http://127.0.0.1:3000/?donation=cancel');
    return response({ url: checkoutUrl });
  } });
});
for (const stripeKey of ['', 'pk_test_notSecret', 'rk_test_unverified']) {
  test('missing or unapproved Stripe credentials fail closed', async () => {
    await assert.rejects(createDonationCheckout({ ...base, stripeKey, fetchImpl: mustNotFetch }), isError(503));
    await assert.rejects(getDonationStatus({ sessionId, stripeKey, fetchImpl: mustNotFetch }), isError(503));
  });
}
for (const url of ['http://checkout.stripe.com/pay', 'https://checkout.stripe.com.evil.org/pay', 'https://evil.org/pay', 'broken', 'https://checkout.stripe.com/']) {
  test(`rejects unsafe or non-checkout Stripe URL ${url}`, async () => {
    await assert.rejects(createDonationCheckout({ ...base, fetchImpl: async () => response({ url }) }), isError(502));
  });
}
for (const [status, body] of [[401, { error: { message: 'secret provider detail' } }], [500, { error: { message: 'secret provider detail' } }], [200, null], [200, { url: 42 }]]) {
  test(`sanitizes checkout provider response ${status} ${String(body)}`, async () => {
    await assert.rejects(createDonationCheckout({ ...base, fetchImpl: async () => response(body, status) }), error =>
      isError(502)(error) && !error.message.includes('secret') && !error.message.includes(key));
  });
}
test('sanitizes checkout transport errors', async () => {
  await assert.rejects(createDonationCheckout({ ...base, fetchImpl: async () => { throw new Error('secret provider detail'); } }),
    error => isError(502)(error) && !error.message.includes('secret'));
});
for (const [status, payment_status, expected] of [
  ['complete', 'paid', 'paid'], ['complete', 'unpaid', 'processing'],
  ['open', 'unpaid', 'incomplete'], ['expired', 'unpaid', 'expired'],
  ['complete', 'processing', 'processing'], ['open', 'paid', 'not_found'],
]) {
  test(`classifies Stripe ${status}/${payment_status} as ${expected} without customer data`, async () => {
    let calls = 0;
    const result = await getDonationStatus({ sessionId, stripeKey: key, fetchImpl: async (url, init) => {
      calls++;
      assert.equal(url, `https://api.stripe.com/v1/checkout/sessions/${sessionId}`);
      assert.equal(init.method, 'GET');
      assert.equal(init.headers.Authorization, `Bearer ${key}`);
      assert.equal(init.headers['Stripe-Version'], undefined);
      assert.equal(init.signal instanceof AbortSignal, true);
      return response({ ...session, status, payment_status });
    } });
    assert.deepEqual(result, { status: expected });
    assert.equal(calls, 1);
  });
}
for (const changes of [
  { metadata: {} }, { amount_total: 499 }, { amount_total: 501 }, { amount_total: '1000' },
  { amount_total: 50001 }, { mode: 'subscription' }, { currency: 'usd' }, { id: 'cs_test_OTHER' },
  { status: 'unknown' },
]) {
  test(`rejects unrelated or malformed retrieved session ${JSON.stringify(changes)}`, async () => {
    assert.deepEqual(await getDonationStatus({ sessionId, stripeKey: key,
      fetchImpl: async () => response({ ...session, ...changes }) }), { status: 'not_found' });
  });
}
for (const invalid of ['cs_test_', 'cs_live_ABC-1', 'xcs_test_ABC', '../evil', 42, '']) {
  test(`rejects invalid session ID ${String(invalid)} before fetch`, async () => {
    await assert.rejects(getDonationStatus({ sessionId: invalid, stripeKey: key, fetchImpl: mustNotFetch }), isError(400));
  });
}
test('Stripe 404 is not_found', async () => {
  assert.deepEqual(await getDonationStatus({ sessionId, stripeKey: key, fetchImpl: async () => response({}, 404) }), { status: 'not_found' });
});
for (const [status, body] of [[500, { error: { message: 'secret customer' } }], [401, {}], [200, null]]) {
  test(`status provider failure ${status} does not leak details`, async () => {
    await assert.rejects(getDonationStatus({ sessionId, stripeKey: key, fetchImpl: async () => response(body, status) }),
      error => isError(502)(error) && !error.message.includes('secret'));
  });
}
