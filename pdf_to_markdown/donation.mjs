const endpoint = 'https://api.stripe.com/v1/checkout/sessions';
const marker = 'pdf_to_markdown';

export class DonationError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'DonationError';
    this.status = status;
  }
}

function validAmount(amount) {
  return Number.isInteger(amount) && amount >= 500 && amount <= 50000 && amount % 100 === 0;
}

function requireKey(stripeKey) {
  if (typeof stripeKey !== 'string' || !/^sk_(test|live)_[A-Za-z0-9]+$/.test(stripeKey)) {
    throw new DonationError(503, 'Donations unavailable');
  }
}

function normalizeOrigin(origin) {
  if (typeof origin !== 'string') throw new DonationError(400, 'Invalid donation request');
  try {
    const url = new URL(origin);
    if (!['https:', 'http:'].includes(url.protocol) ||
        (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
        origin !== `${url.origin}/` && origin !== url.origin &&
        !(url.protocol === 'https:' && (origin === `${url.origin}:443` || origin === `${url.origin}:443/`))) {
      throw new Error('not an origin');
    }
    return url.origin;
  } catch {
    throw new DonationError(400, 'Invalid donation request');
  }
}

async function requestStripe(url, init, fetchImpl) {
  try {
    const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(10000) });
    if (response.status === 404 && init.method === 'GET') return null;
    if (!response.ok) throw new Error('provider failure');
    const json = await response.json();
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('invalid response');
    return json;
  } catch {
    throw new DonationError(502, 'Payment provider unavailable');
  }
}

export async function createDonationCheckout(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !['amountCents', 'locale', 'origin', 'stripeKey', 'fetchImpl'].includes(key))) {
    throw new DonationError(400, 'Invalid donation request');
  }
  const { amountCents, locale, origin, stripeKey, fetchImpl = fetch } = options;
  if (!validAmount(amountCents) || !['de', 'en'].includes(locale)) {
    throw new DonationError(400, 'Invalid donation request');
  }
  const normalizedOrigin = normalizeOrigin(origin);
  requireKey(stripeKey);
  const form = new URLSearchParams({
    mode: 'payment', locale,
    'metadata[donation_context]': marker,
    'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][unit_amount]': String(amountCents),
    'line_items[0][price_data][product_data][name]': 'Voluntary support for Marco Rudolph',
    'line_items[0][quantity]': '1',
    success_url: `${normalizedOrigin}/?donation=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${normalizedOrigin}/?donation=cancel`,
  });
  const result = await requestStripe(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  }, fetchImpl);
  try {
    const url = new URL(result.url);
    if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' ||
        url.port || url.username || url.password || url.pathname === '/' || result.url !== url.href) {
      throw new Error('invalid checkout URL');
    }
    return { url: result.url };
  } catch {
    throw new DonationError(502, 'Payment provider unavailable');
  }
}

export async function getDonationStatus({ sessionId, stripeKey, fetchImpl = fetch } = {}) {
  if (typeof sessionId !== 'string' || !/^cs_(test_|live_)[A-Za-z0-9]+$/.test(sessionId)) {
    throw new DonationError(400, 'Invalid donation request');
  }
  requireKey(stripeKey);
  const session = await requestStripe(`${endpoint}/${encodeURIComponent(sessionId)}`, {
    method: 'GET', headers: { Authorization: `Bearer ${stripeKey}` },
  }, fetchImpl);
  if (session === null || session.id !== sessionId || session.mode !== 'payment' ||
      session.currency !== 'eur' || !validAmount(session.amount_total) ||
      session.metadata?.donation_context !== marker) return { status: 'not_found' };
  if (session.status === 'complete') {
    if (session.payment_status === 'paid') return { status: 'paid' };
    if (['unpaid', 'processing'].includes(session.payment_status)) return { status: 'processing' };
  }
  if (session.status === 'open' && session.payment_status === 'unpaid') return { status: 'incomplete' };
  if (session.status === 'expired') return { status: 'expired' };
  return { status: 'not_found' };
}
