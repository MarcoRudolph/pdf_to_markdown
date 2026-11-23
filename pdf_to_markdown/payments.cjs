const { createHash, createHmac } = require('node:crypto');

function createPayments({ stripe, paygate, stripePriceId, publicBaseUrl, codeSecret }) {
  if (!stripePriceId || !publicBaseUrl || !codeSecret) throw new Error('Payment configuration missing');
  const codeHash = code => createHash('sha256').update(code, 'utf8').digest('hex');
  const restoreCode = ref => createHmac('sha256', codeSecret).update('pdf2md|' + ref, 'utf8').digest('base64url');
  return {
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
