import { test } from 'node:test';
import assert from 'node:assert/strict';

const origin = 'https://example.com';
const env = { STRIPE_SECRET_KEY: 'sk_test_123abc', DONATION_ORIGIN: `${origin}/` };
const sessionId = 'cs_test_123abc';
const paidSession = { id: sessionId, mode: 'payment', currency: 'eur', amount_total: 500, metadata: { donation_context: 'pdf_to_markdown' }, status: 'complete', payment_status: 'paid' };
const checkoutUrl = 'https://checkout.stripe.com/c/pay/test123';

async function call(route, method, { requestOrigin = origin, body, contentType = 'application/json', query = '', config = env, stripe = async () => new Response(JSON.stringify({ url: checkoutUrl, ...paidSession }), { status: 200 }) } = {}) {
  const saved = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => { calls.push(args); return stripe(...args); };
  try {
    const { onRequest } = await import(route === 'post' ? './functions/api/donate.js' : './functions/api/donate/status.js');
    const headers = {};
    if (requestOrigin !== null) headers.Origin = requestOrigin;
    if (body !== undefined) headers['Content-Type'] = contentType;
    const request = new Request(`https://example.com/api/donate${route === 'status' ? '/status' : ''}${query}`, { method, headers, ...(body !== undefined ? { body } : {}) });
    const response = await onRequest({ request, env: config });
    return { response, data: await response.json(), calls };
  } finally { globalThis.fetch = saved; }
}

function headers(response, allow) {
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  if (allow) assert.equal(response.headers.get('Allow'), allow);
}

test('Pages checkout handler imports and returns only a checkout URL with configured canonical return origin', async () => {
  const { response, data, calls } = await call('post', 'POST', { body: JSON.stringify({ amountCents: 500, locale: 'de' }) });
  assert.equal(response.status, 201);
  assert.deepEqual(data, { url: checkoutUrl });
  headers(response);
  assert.equal(calls.length, 1);
  const form = new URLSearchParams(calls[0][1].body);
  assert.equal(form.get('success_url'), 'https://example.com/?donation=success&session_id={CHECKOUT_SESSION_ID}');
  assert.equal(form.get('cancel_url'), 'https://example.com/?donation=cancel');
});

test('Pages checkout rejects missing, mismatched and www origins before contacting Stripe', async () => {
  for (const requestOrigin of [null, 'https://evil.example', 'https://www.example.com']) {
    const { response, calls } = await call('post', 'POST', { requestOrigin, body: '{"amountCents":500,"locale":"en"}' });
    assert.equal(response.status, 403);
    headers(response);
    assert.equal(calls.length, 0);
  }
});

test('Pages checkout rejects malformed JSON, disallowed keys, and chunked oversize payloads', async () => {
  for (const [body, status] of [['{', 400], ['{"amountCents":500,"locale":"en","price":5}', 400], ['x'.repeat(1025), 413]]) {
    const { response, calls } = await call('post', 'POST', { body });
    assert.equal(response.status, status);
    headers(response);
    assert.equal(calls.length, 0);
  }
});

test('Pages checkout requires configuration and redacts Stripe errors', async () => {
  for (const config of [{ ...env, STRIPE_SECRET_KEY: '' }, { ...env, DONATION_ORIGIN: '' }]) {
    const { response, calls } = await call('post', 'POST', { body: '{"amountCents":500,"locale":"en"}', config });
    assert.equal(response.status, 503);
    assert.equal(calls.length, 0);
  }
  const { response, data } = await call('post', 'POST', { body: '{"amountCents":500,"locale":"en"}', stripe: async () => new Response('secret Stripe failure', { status: 500 }) });
  assert.equal(response.status, 502);
  assert.doesNotMatch(JSON.stringify(data), /secret|Stripe failure|sk_test/i);
});

test('Pages status checks Stripe for paid and unpaid sessions, rejects malformed IDs', async () => {
  for (const [session, expected] of [[paidSession, 'paid'], [{ ...paidSession, payment_status: 'unpaid' }, 'processing']]) {
    const { response, data } = await call('status', 'GET', { query: `?session_id=${sessionId}`, stripe: async () => Response.json(session) });
    assert.equal(response.status, 200);
    assert.deepEqual(data, { status: expected });
    headers(response);
  }
  const { response, calls } = await call('status', 'GET', { query: '?session_id=not-a-session' });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test('Pages routes reject unsupported methods including OPTIONS with Allow and privacy headers', async () => {
  for (const [route, method, allow] of [['post', 'OPTIONS', 'POST'], ['post', 'GET', 'POST'], ['status', 'OPTIONS', 'GET'], ['status', 'POST', 'GET']]) {
    const { response, calls } = await call(route, method, { ...(method === 'POST' ? { body: '{}' } : {}) });
    assert.equal(response.status, 405);
    headers(response, allow);
    assert.equal(calls.length, 0);
  }
});
