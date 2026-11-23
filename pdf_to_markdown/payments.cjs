const { createHash, createHmac } = require('node:crypto');

function createPayments({ stripe, paygate, stripePriceId, publicBaseUrl, codeSecret, webhookSecret }) {
  if (!stripePriceId || !publicBaseUrl || !codeSecret) throw new Error('Payment configuration missing');
  const codeHash = code => createHash('sha256').update(code, 'utf8').digest('hex');
  const restoreCode = ref => createHmac('sha256', codeSecret).update('pdf2md|' + ref, 'utf8').digest('base64url');
  const hex64 = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
  const scoped = pi => pi && typeof pi === 'object' && pi.metadata?.app === 'pdf2md' && pi.metadata?.sku === 'pass50';
  const reversal = charge => charge.disputed === true ? 'disputed' :
    (charge.refunded === true || charge.amount_refunded === 200 ? 'refunded' : null);
  async function currentReversal(pi, charge) {
    const currentPi = await stripe.paymentIntents.retrieve(pi.id, { expand: ['latest_charge'] });
    if (!scoped(currentPi) || currentPi.id !== pi.id || typeof currentPi.latest_charge !== 'object' ||
        !currentPi.latest_charge || currentPi.latest_charge.id !== charge.id) throw new Error('Provider state unavailable');
    const currentCharge = await stripe.charges.retrieve(charge.id);
    if (!currentCharge || currentCharge.id !== charge.id || currentCharge.payment_intent !== pi.id ||
        currentCharge.status !== 'succeeded') throw new Error('Provider state unavailable');
    return reversal(currentCharge);
  }
  async function alert(event, reason) {
    // The only durable alert content is a digest and one of four fixed codes.
    if (typeof event.id !== 'string' || !event.id) throw new Error('Invalid event');
    await paygate.recordAnomaly(codeHash(event.id), reason);
  }
  return {
    async webhook(raw, signature) {
      if (!webhookSecret || typeof signature !== 'string' || !signature) return { status: 400 };
      let event;
      try { event = stripe.webhooks.constructEvent(raw, signature, webhookSecret); }
      catch { return { status: 400 }; }
      if (!event || !event.data || !event.data.object) return { status: 503 };
      if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
        const id = event.data.object.id;
        if (typeof id !== 'string' || !/^cs_[A-Za-z0-9_]+$/.test(id)) { await alert(event, 'invalid_provider_shape'); return { status: 200 }; }
        const session = await stripe.checkout.sessions.retrieve(id, { expand: ['payment_intent.latest_charge'] });
        const items = await stripe.checkout.sessions.listLineItems(id, { limit: 2 });
        if (session?.id !== id || !items || !Array.isArray(items.data) || items.data.length !== 1 || items.has_more !== false ||
            items.data[0]?.quantity !== 1 || typeof items.data[0]?.price !== 'object' || !items.data[0].price) {
          await alert(event, 'invalid_provider_shape'); return { status: 200 };
        }
        if (session.payment_status !== 'paid') return { status: 200 };
        if (items.data[0].price.id !== stripePriceId || session.amount_total !== 200 || session.currency !== 'eur') {
          await alert(event, 'price_mismatch'); return { status: 200 };
        }
        if (session.metadata?.app !== 'pdf2md' || session.metadata?.sku !== 'pass50' ||
            !hex64(session.metadata?.subject_hash) || session.client_reference_id !== session.metadata.subject_hash) {
          await alert(event, 'metadata_mismatch'); return { status: 200 };
        }
        if (typeof session.customer_details?.email !== 'string' ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(session.customer_details.email)) {
          await alert(event, 'missing_email'); return { status: 200 };
        }
        const pi = session.payment_intent;
        const charge = pi?.latest_charge;
        if (session.mode !== 'payment' || session.status !== 'complete' || !scoped(pi) ||
            pi.status !== 'succeeded' || pi.amount !== 200 || pi.currency !== 'eur' ||
            !pi.id || typeof charge !== 'object' || !charge || !charge.id || charge.status !== 'succeeded' ||
            charge.payment_intent !== pi.id || (session.customer != null && typeof session.customer !== 'string')) {
          await alert(event, 'invalid_provider_shape'); return { status: 200 };
        }
        const before = await currentReversal(pi, charge);
        if (before) { await paygate.recordReversal(pi.id, before); return { status: 200 }; }
        await paygate.fulfillGuarded({ email: session.customer_details.email, ref: session.id,
          paymentIntentId: pi.id, codeHash: codeHash(restoreCode(session.id)),
          subjectHash: session.metadata.subject_hash, stripeCustomerId: session.customer || null,
          sku: 'pass50', amountCents: 200, currency: 'eur' });
        const after = await currentReversal(pi, charge);
        if (after) await paygate.recordReversal(pi.id, after);
        return { status: 200 };
      }
      if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
        const id = event.type === 'charge.refunded' ? event.data.object.id : event.data.object.charge;
        if (typeof id !== 'string' || !id.startsWith('ch_')) { await alert(event, 'invalid_provider_shape'); return { status: 200 }; }
        const charge = await stripe.charges.retrieve(id);
        if (!charge || charge.id !== id || typeof charge.payment_intent !== 'string') {
          await alert(event, 'invalid_provider_shape'); return { status: 200 };
        }
        const pi = await stripe.paymentIntents.retrieve(charge.payment_intent, { expand: ['latest_charge'] });
        if (!scoped(pi)) return { status: 200 };
        if (pi.id !== charge.payment_intent || pi.amount !== 200 || pi.currency !== 'eur' ||
            charge.status !== 'succeeded' || (pi.latest_charge && typeof pi.latest_charge === 'object' && pi.latest_charge.id !== id)) {
          await alert(event, 'invalid_provider_shape'); return { status: 200 };
        }
        const state = reversal(charge);
        if (state) await paygate.recordReversal(pi.id, state);
        return { status: 200 };
      }
      return { status: 200 };
    },
    codeHash,
    restoreCode,
    async checkout(subjectHash) {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment', line_items: [{ price: stripePriceId, quantity: 1 }],
        success_url: publicBaseUrl + '/?session_id={CHECKOUT_SESSION_ID}', cancel_url: publicBaseUrl + '/',
        client_reference_id: subjectHash,
        metadata: { app: 'pdf2md', sku: 'pass50', subject_hash: subjectHash },
        payment_intent_data: { metadata: { app: 'pdf2md', sku: 'pass50' } },
      });
      if (typeof session.url !== 'string' || !/^https:\/\//.test(session.url)) throw new Error('Checkout unavailable');
      return { url: session.url };
    },
    async status(ref, subjectHash) {
      const session = await stripe.checkout.sessions.retrieve(ref);
      if (!session || session.id !== ref || session.payment_status !== 'paid' ||
          session.client_reference_id !== subjectHash || session.metadata?.app !== 'pdf2md' ||
          session.metadata?.sku !== 'pass50' || session.metadata?.subject_hash !== subjectHash) return { status: 'pending' };
      if (!await paygate.checkoutFulfilled(ref, subjectHash)) return { status: 'pending' };
      return { status: 'ready', restore_code: restoreCode(session.id) };
    },
    async redeem(code, subjectHash) {
      const result = await paygate.redeemEntitlement(codeHash(code), subjectHash);
      return { passes: result ? 1 : 0 };
    },
  };
}
module.exports = { createPayments };
