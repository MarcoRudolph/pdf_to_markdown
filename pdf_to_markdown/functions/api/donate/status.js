import { getDonationStatus, DonationError } from '../../../donation.mjs';

function json(status, value, extra = {}) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...extra } });
}
export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' }, { Allow: 'GET' });
  try {
    if (!env?.STRIPE_SECRET_KEY || !env?.DONATION_ORIGIN) throw new DonationError(503, 'Donations unavailable');
    const url = new URL(request.url);
    if (url.searchParams.getAll('session_id').length !== 1) throw new DonationError(400, 'Invalid donation request');
    const result = await getDonationStatus({ sessionId: url.searchParams.get('session_id'), stripeKey: env.STRIPE_SECRET_KEY, fetchImpl: globalThis.fetch });
    return json(200, result);
  } catch (error) {
    if (error instanceof DonationError) return json(error.status, { error: error.message });
    return json(502, { error: 'Payment provider unavailable' });
  }
}
