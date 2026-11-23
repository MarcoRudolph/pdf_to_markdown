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
  return {
    async verifyStartup() {
      const { rows } = await pool.query({ text: `select current_user as role, a.active as app_active, a.timezone,
        a.free_units_per_day, a.free_units_per_day_ip, a.free_limits,
        p.active as product_active, p.amount_cents, p.currency, p.units, p.quota_period,
        p.valid_days, p.limits, p.stripe_price_id,
        has_function_privilege(current_user, 'paygate.quota_pdf2md(text,text)', 'EXECUTE') as scoped_quota,
        has_function_privilege(current_user, 'paygate.consume_pdf2md_free(text,text)', 'EXECUTE') as scoped_free,
        has_function_privilege(current_user, 'paygate.consume_pdf2md_paid(text)', 'EXECUTE') as scoped_paid,
        has_function_privilege(current_user, 'paygate.quota(text,text,text)', 'EXECUTE') as generic_quota,
        has_function_privilege(current_user, 'paygate.consume_free(text,text,text)', 'EXECUTE') as generic_free,
        has_function_privilege(current_user, 'paygate.consume_paid(text,text)', 'EXECUTE') as generic_paid
        from paygate.apps a join paygate.products p on p.app_id = a.id
        where a.id = $1 and p.sku = $2`, values: [APP, 'pass50'] });
      const row = rows[0];
      if (!row || !row.scoped_quota || !row.scoped_free || !row.scoped_paid ||
          row.generic_quota || row.generic_free || row.generic_paid) {
        throw new Error('paygate scoped quota privileges missing or generic grants remain (030 required)');
      }
      return row;
    },
    quota(subjectHash, clientIp) {
      return transaction(async (client, day) => {
        const { rows } = await client.query({ text: 'select paygate.quota_pdf2md($1,$2) as quota', values: [subjectHash, ipHash(clientIp, day)] });
        if (!rows[0]?.quota) throw new Error('paygate quota unavailable');
        return { day, ...rows[0].quota };
      });
    },
    reserveFree(subjectHash, clientIp) {
      return transaction(async (client, day) => {
        const hashedIp = ipHash(clientIp, day);
        const { rows } = await client.query({ text: 'select paygate.consume_pdf2md_free($1,$2) as consumed', values: [subjectHash, hashedIp] });
        return rows[0]?.consumed ? { day, subjectHash, ipHash: hashedIp, units: 1 } : null;
      });
    },
    reservePaid(subjectHash) {
      return transaction(async (client, day) => {
        const { rows } = await client.query({ text: 'select paygate.consume_pdf2md_paid($1) as consumed', values: [subjectHash] });
        return rows[0]?.consumed ? { day, ...rows[0].consumed } : null;
      });
    },
    async refundFreeDay(subjectHash, hashedIp, day) {
      const { rows } = await pool.query({ text: 'select paygate.refund_pdf2md_free_day($1,$2,$3) as refunded', values: [subjectHash, hashedIp, day] });
      return rows[0].refunded;
    },
    async refundPaidDay(entitlementId, day) {
      const { rows } = await pool.query({ text: 'select paygate.refund_pdf2md_paid_day($1,$2) as refunded', values: [entitlementId, day] });
      return rows[0].refunded;
    },
    async checkoutFulfilled(ref, subjectHash) {
      const { rows } = await pool.query({ text: 'select paygate.checkout_fulfilled($1,$2) as fulfilled', values: [ref, subjectHash] });
      return rows[0].fulfilled;
    },
    async fulfillGuarded(args) {
      if (args.sku !== 'pass50' || args.amountCents !== 200 || args.currency !== 'eur' || !args.codeHash || !args.ref || !args.email || !args.paymentIntentId || !args.subjectHash) {
        throw new Error('paygate fulfillment metadata mismatch');
      }
      const values = [args.email, args.ref, args.paymentIntentId, args.codeHash, args.subjectHash, args.stripeCustomerId || null];
      const { rows } = await pool.query({ text: 'select paygate.pdf2md_fulfill_guarded($1,$2,$3,$4,$5,$6) as entitlement_id', values });
      return rows[0].entitlement_id;
    },
    async recordReversal(paymentIntentId, status) {
      if (!['refunded', 'disputed'].includes(status)) throw new Error('Invalid reversal status');
      const { rows } = await pool.query({ text: 'select paygate.pdf2md_record_reversal($1,$2) as reversed', values: [paymentIntentId, status] });
      return rows[0].reversed;
    },
    async redeemEntitlement(codeHash, subjectHash) {
      const { rows } = await pool.query({ text: 'select paygate.redeem_pdf2md_entitlement($1,$2,$3) as redeemed', values: [codeHash, subjectHash, 5] });
      return rows[0].redeemed;
    },
    async recordAnomaly(eventHash, reason) {
      if (!['price_mismatch', 'metadata_mismatch', 'missing_email', 'invalid_provider_shape'].includes(reason)) throw new Error('Invalid anomaly reason');
      if (!/^[0-9a-f]{64}$/.test(eventHash)) throw new Error('Invalid anomaly event hash');
      await pool.query({ text: 'select paygate.pdf2md_record_anomaly($1,$2) as recorded', values: [eventHash, reason] });
    },
    close() { return pool.end(); },
  };
}
module.exports = { createPaygate };
