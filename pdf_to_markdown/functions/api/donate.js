import { createDonationCheckout, DonationError } from '../../donation.mjs';

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
function json(status, value, extra = {}) {
  return Response.json(value, { status, headers: { ...headers, ...extra } });
}
function configuredOrigin(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) ||
        (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
        ![url.origin, `${url.origin}/`, ...(url.protocol === 'https:' ? [`${url.origin}:443`, `${url.origin}:443/`] : [])].includes(value)) return null;
    return url.origin;
  } catch { return null; }
}
async function readJson(request) {
  if (request.headers.get('content-type') !== 'application/json') throw new DonationError(400, 'Invalid donation request');
  const reader = request.body?.getReader();
  if (!reader) throw new DonationError(400, 'Invalid donation request');
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1024) {
      await reader.cancel();
      throw new DonationError(413, 'Donation request too large');
    }
    chunks.push(value);
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        Object.keys(data).some(key => !['amountCents', 'locale'].includes(key))) throw new Error('invalid input');
    return data;
  } catch { throw new DonationError(400, 'Invalid donation request'); }
}
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' }, { Allow: 'POST' });
  try {
    const origin = configuredOrigin(env?.DONATION_ORIGIN);
    if (!origin || !env?.STRIPE_SECRET_KEY) throw new DonationError(503, 'Donations unavailable');
    if (request.headers.get('origin') !== origin) throw new DonationError(403, 'Forbidden');
    const data = await readJson(request);
    const result = await createDonationCheckout({ ...data, origin, stripeKey: env.STRIPE_SECRET_KEY, fetchImpl: globalThis.fetch });
    return json(201, result);
  } catch (error) {
    if (error instanceof DonationError) return json(error.status, { error: error.message });
    return json(502, { error: 'Payment provider unavailable' });
  }
}
