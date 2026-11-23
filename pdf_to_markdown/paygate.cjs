// Server-only access to the paygate SQL function boundary. No table writes.
const { createHmac } = require('node:crypto');
const { Pool } = require('pg');
const APP = 'pdf2md';
const DAY_SQL = "select (now() at time zone 'Europe/Berlin')::date::text as day";

function createPaygate({ databaseUrl, ipSecret, pool = new Pool({ connectionString: databaseUrl, max: 5 }) }) {
  if (!ipSecret || Buffer.byteLength(ipSecret) < 32) throw new Error('PAYGATE_IP_SECRET required');
  const ipHash = (ip, day) => createHmac('sha256', ipSecret).update(ip + '|' + day).digest('hex');
  async function transaction(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const day = (await client.query(DAY_SQL)).rows[0].day;
      const result = await work(client, day);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
      throw err;
    } finally { client.release(); }
  }
  async function checkedRefund(day, work) {
    return transaction(async (client, currentDay) => {
      if (day !== currentDay) throw new Error('paygate refund day changed; refusing wrong-day refund');
      return work(client);
    });
  }
  return {
    async verifyStartup() {
      const { rows } = await pool.query({ text: `select current_user as role, a.active as app_active, a.timezone,
        a.free_units_per_day, a.free_units_per_day_ip, a.free_limits,
        p.active as product_active, p.amount_cents, p.currency, p.units, p.quota_period,
        p.valid_days, p.limits, p.stripe_price_id
        from paygate.apps a join paygate.products p on p.app_id = a.id
        where a.id = $1 and p.sku = $2`, values: [APP, 'pass50'] });
      return rows[0] || null;
    },
    quota(subjectHash, clientIp) {
      return transaction(async (client, day) => {
        const { rows } = await client.query({ text: 'select paygate.quota($1,$2,$3) as quota', values: [APP, subjectHash, ipHash(clientIp, day)] });
        if (!rows[0]?.quota) throw new Error('paygate quota unavailable');
        return { day, ...rows[0].quota };
      });
    },
    reserveFree(subjectHash, clientIp) {
      return transaction(async (client, day) => {
        const hashedIp = ipHash(clientIp, day);
        const { rows } = await client.query({ text: 'select paygate.consume_free($1,$2,$3) as consumed', values: [APP, subjectHash, hashedIp] });
        return rows[0]?.consumed ? { day, subjectHash, ipHash: hashedIp, units: 1 } : null;
      });
    },
    reservePaid(subjectHash) {
      return transaction(async (client, day) => {
        const { rows } = await client.query({ text: 'select paygate.consume_paid($1,$2) as consumed', values: [APP, subjectHash] });
        return rows[0]?.consumed ? { day, ...rows[0].consumed } : null;
      });
    },
    refundFreeDay(subjectHash, hashedIp, day) {
      return checkedRefund(day, client => client.query({ text: 'select paygate.refund_free($1,$2,$3)', values: [APP, subjectHash, hashedIp] }));
    },
    refundPaidDay(entitlementId, day) {
      return checkedRefund(day, client => client.query({ text: 'select paygate.refund_paid($1)', values: [entitlementId] }));
    },
    // The current DB grant cannot read purchases or perform a guarded checkout lookup.
    async checkoutFulfilled() { throw new Error('paygate checkout lookup unavailable without a granted SQL function'); },
    async fulfillGuarded(args) {
      if (args.sku !== 'pass50' || args.amountCents !== 200 || args.currency !== 'eur' || !args.codeHash || !args.ref || !args.email) {
        throw new Error('paygate fulfillment metadata mismatch');
      }
      const values = [APP, args.sku, args.email, args.ref, args.paymentIntentId, args.amountCents, args.currency,
        args.codeHash, args.subjectHash || null, args.stripeCustomerId || null, args.stripeSubscriptionId || null, args.expiresAt || null];
      const { rows } = await pool.query({ text: `select paygate.fulfill_purchase(${values.map((_, i) => '$' + (i + 1)).join(',')}) as entitlement_id`, values });
      return rows[0]?.entitlement_id;
    },
    async recordReversal(paymentIntentId, status) {
      if (!['refunded', 'disputed'].includes(status)) throw new Error('Invalid reversal status');
      const { rows } = await pool.query({ text: 'select paygate.refund_purchase($1,$2) as reversed', values: [paymentIntentId, status] });
      return rows[0]?.reversed;
    },
    async redeemEntitlement(codeHash, subjectHash) {
      const { rows } = await pool.query({ text: 'select paygate.redeem_code($1,$2,$3) as redeemed', values: [APP, codeHash, subjectHash] });
      return rows[0]?.redeemed;
    },
    async recordAnomaly() { throw new Error('paygate anomaly recording unavailable without a granted SQL function'); },
    close() { return pool.end(); },
  };
}
module.exports = { createPaygate };
