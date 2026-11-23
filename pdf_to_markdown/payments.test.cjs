const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, createHmac } = require('node:crypto');
const { createServer } = require('./server.cjs');
const { createPayments } = require('./payments.cjs');
const secret = 'test-code-secret-with-more-than-32-bytes';
const base = 'https://pdf.example.test';
const subject = 'a'.repeat(64);
const paid = { id: 'cs_paid_1', payment_status: 'paid', client_reference_id: subject, metadata: { app: 'pdf2md', sku: 'pass50', subject_hash: subject } };
function fixture() {
  const calls = [], refs = [], redeems = [];
  let session = paid, fulfilled = true;
  const stripe = { checkout: { sessions: {
    async create(args) { calls.push(args); session = { ...paid, client_reference_id: args.client_reference_id, metadata: args.metadata }; return { url: 'https://checkout.stripe.test/session' }; },
    async retrieve(ref) { refs.push(ref); return session; },
  } } };
  const paygate = {
    async checkoutFulfilled(ref, buyer) { assert.equal(ref, session.id); assert.equal(buyer, session.client_reference_id); return fulfilled; },
    async redeemEntitlement(hash, buyer) { redeems.push([hash, buyer]); return hash === createHash('sha256').update('purchase-one').digest('hex') ? 1 : 0; },
  };
  return { stripe, paygate, calls, refs, redeems, setSession(value) { session = value; }, setFulfilled(value) { fulfilled = value; } };
}
function payments(f) { return createPayments({ stripe: f.stripe, paygate: f.paygate, stripePriceId: 'price_fixed', publicBaseUrl: base, codeSecret: secret }); }
test('checkout fixes server-side price and binds only subject hash, never client secrets', async () => {
  const f = fixture();
  assert.deepEqual(await payments(f).checkout(subject), { url: 'https://checkout.stripe.test/session' });
  assert.deepEqual(f.calls, [{ mode: 'payment', line_items: [{ price: 'price_fixed', quantity: 1 }],
    success_url: base + '/?session_id={CHECKOUT_SESSION_ID}', cancel_url: base + '/',
    client_reference_id: subject, metadata: { app: 'pdf2md', sku: 'pass50', subject_hash: subject },
    payment_intent_data: { metadata: { app: 'pdf2md', sku: 'pass50' } } }]);
  assert.doesNotMatch(JSON.stringify(f.calls), /cookie|192\.0\.2|restore|code|amount/);
});
test('paid status requires exact buyer-bound DB lookup and deterministic code; never fulfills from polling', async () => {
  const f = fixture(), p = payments(f);
  const code = createHmac('sha256', secret).update('pdf2md|' + paid.id, 'utf8').digest('base64url');
  assert.deepEqual(await p.status(paid.id, subject), { status: 'ready', restore_code: code });
  assert.deepEqual(await p.status(paid.id, subject), { status: 'ready', restore_code: code });
  assert.deepEqual(f.refs, [paid.id, paid.id]);
  assert.match(p.codeHash(code), /^[0-9a-f]{64}$/);
  assert.equal(p.codeHash(code), createHash('sha256').update(code, 'utf8').digest('hex'));
  f.setFulfilled(false);
  assert.deepEqual(await p.status(paid.id, subject), { status: 'pending' });
});
test('unpaid, mismatched and unrelated Stripe sessions never expose restore code or query DB', async () => {
  const f = fixture(), p = payments(f);
  for (const change of [{ ...paid, payment_status: 'unpaid' }, { ...paid, client_reference_id: 'b'.repeat(64) },
    { ...paid, metadata: { ...paid.metadata, sku: 'other' } }, { ...paid, metadata: { ...paid.metadata, subject_hash: 'b'.repeat(64) } },
    { ...paid, metadata: { ...paid.metadata, app: 'other' } }, { ...paid, id: 'cs_other' }]) {
    f.setSession(change);
    assert.deepEqual(await p.status(paid.id, subject), { status: 'pending' });
  }
});
test('redeem hashes input, delegates one-purchase ownership and flattens invalid/capped results', async () => {
  const f = fixture(), p = payments(f);
  assert.deepEqual(await p.redeem('purchase-one', subject), { passes: 1 });
  assert.deepEqual(await p.redeem('another-purchase', subject), { passes: 0 });
  assert.deepEqual(f.redeems, [
    [createHash('sha256').update('purchase-one').digest('hex'), subject],
    [createHash('sha256').update('another-purchase').digest('hex'), subject],
  ]);
});
test('a code redeems only its purchase, not a second purchase sharing the buyer email', async () => {
  const f = fixture(), p = payments(f);
  const first = p.restoreCode('cs_paid_1'), second = p.restoreCode('cs_paid_2');
  const firstHash = p.codeHash(first), secondHash = p.codeHash(second);
  const ownership = new Map([[firstHash, new Set()], [secondHash, new Set()]]);
  f.paygate.redeemEntitlement = async (hash, buyer) => {
    if (!ownership.has(hash)) return 0;
    ownership.get(hash).add(buyer);
    return 1;
  };
  const newDevice = 'b'.repeat(64);
  assert.deepEqual(await p.redeem(first, newDevice), { passes: 1 });
  assert.deepEqual([...ownership.get(firstHash)], [newDevice]);
  assert.equal(ownership.get(secondHash).has(newDevice), false);
  assert.deepEqual(await p.redeem(second, newDevice), { passes: 1 });
  assert.equal(ownership.get(secondHash).has(newDevice), true);
  // Task 5 must pass these hashes to fulfillGuarded after signature verification.
});
async function harness(t, overrides = {}) {
  const f = fixture(); Object.assign(f.stripe.checkout.sessions, overrides.stripe || {});
  Object.assign(f.paygate, overrides.paygate || {});
  const server = createServer({ token: 'token', apiUrl: 'http://127.0.0.1:8000', buildDir: __dirname,
    paygate: f.paygate, stripe: f.stripe, stripePriceId: 'price_fixed', publicBaseUrl: base, codeSecret: secret,
    cookieSecret: 'test-cookie-secret', trustedProxyIp: '192.0.2.8' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}`;
  async function request(route, { body, cookie, origin = base, method = body === undefined ? 'GET' : 'POST' } = {}) {
    const response = await fetch(root + route, { method, headers: { ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.text(), headers: response.headers };
  }
  return { f, request };
}
test('HTTP checkout refuses client price/sku/amount and sets no-referrer', async t => {
  const { f, request } = await harness(t);
  const good = await request('/v1/checkout', { body: {} });
  assert.equal(good.status, 200); assert.equal(good.headers.get('referrer-policy'), 'no-referrer');
  assert.deepEqual(JSON.parse(good.body), { url: 'https://checkout.stripe.test/session' });
  for (const body of [{ price: 'price_attacker' }, { amount: 1 }, { sku: 'other' }])
    assert.equal((await request('/v1/checkout', { body })).status, 400);
  assert.equal(f.calls.length, 1);
});
test('HTTP status binds cookie buyer, returns only status/code and keeps pending on wrong buyer', async t => {
  const { request } = await harness(t);
  const first = await request('/v1/checkout', { body: {} });
  const cookie = first.headers.get('set-cookie').split(';')[0];
  const ready = await request('/v1/checkout-status?session_id=cs_paid_1', { cookie });
  assert.equal(ready.status, 200); assert.deepEqual(Object.keys(JSON.parse(ready.body)).sort(), ['restore_code', 'status']);
  assert.equal(JSON.parse(ready.body).status, 'ready');
  const other = await request('/v1/checkout-status?session_id=cs_paid_1');
  assert.deepEqual(JSON.parse(other.body), { status: 'pending' });
  assert.equal(other.headers.get('referrer-policy'), 'no-referrer');
});
test('HTTP invalid/oversized redeem 400, burst 429, Stripe outage 503 redacted', async t => {
  const { f, request } = await harness(t);
  assert.equal((await request('/v1/redeem', { body: { code: '' } })).status, 400);
  assert.equal((await request('/v1/redeem', { body: { code: 'x'.repeat(129) } })).status, 400);
  const first = await request('/v1/checkout', { body: {} });
  const cookie = first.headers.get('set-cookie').split(';')[0];
  let limited;
  for (let n = 0; n < 30; n++) {
    limited = await request('/v1/redeem', { body: { code: 'missing' }, cookie });
    if (limited.status === 429) break;
  }
  assert.equal(limited.status, 429);
  f.stripe.checkout.sessions.create = async () => { throw Error('Stripe private credentials'); };
  const error = await request('/v1/checkout', { body: {} });
  assert.equal(error.status, 503); assert.doesNotMatch(error.body, /private|credentials/);
});

function webhookFixture() {
  const charge = { id:'ch_1', status:'succeeded', payment_intent:'pi_1', amount:200, currency:'eur', refunded:false, amount_refunded:0, disputed:false };
  const pi = { id:'pi_1', status:'succeeded', amount:200, currency:'eur', metadata:{app:'pdf2md',sku:'pass50'}, latest_charge:charge };
  const session = { id:'cs_1', mode:'payment', status:'complete', payment_status:'paid', amount_total:200, currency:'eur', metadata:{app:'pdf2md',sku:'pass50',subject_hash:subject}, client_reference_id:subject, customer_details:{email:'buyer@example.invalid'}, payment_intent:pi, customer:'cus_1' };
  const items = {data:[{quantity:1,price:{id:'price_fixed'}}],has_more:false};
  const calls=[], actions=[]; let event={id:'evt_1',type:'checkout.session.completed',data:{object:{id:'cs_1'}}};
  const stripe={webhooks:{constructEvent(raw,sig,key){calls.push(['verify',Buffer.isBuffer(raw),sig,key]);if(sig!=='signed')throw Error('invalid');return event;}},checkout:{sessions:{async retrieve(id,opts){calls.push(['session',id,opts]);return session;},async listLineItems(id,opts){calls.push(['items',id,opts]);return items;}}},paymentIntents:{async retrieve(id,opts){calls.push(['pi',id,opts]);return pi;}},charges:{async retrieve(id){calls.push(['charge',id]);return charge;}}};
  const paygate={async fulfillGuarded(a){actions.push(['fulfill',a]);return 'entitlement';},async recordReversal(id,state){actions.push(['reverse',id,state]);return true;},async recordAnomaly(hash,reason){actions.push(['alert',hash,reason]);}};
  return {stripe,paygate,session,pi,charge,items,calls,actions,setEvent(e){event=e;}};
}
async function webhookHarness(t,f) {
  const server=createServer({token:'token',apiUrl:'http://127.0.0.1:8000',buildDir:__dirname,paygate:f.paygate,stripe:f.stripe,stripePriceId:'price_fixed',stripeWebhookSecret:'whsec_test',publicBaseUrl:base,codeSecret:secret,cookieSecret:'test-cookie-secret',trustedProxyIp:'192.0.2.8'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  return async(sig='signed',body='{}')=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/v1/stripe/webhook`,{method:'POST',headers:sig===null?{}:{'stripe-signature':sig},body});return {status:r.status,body:await r.text()};};
}
test('webhook verifies raw signature before provider or DB, caps body, then validates paid state and code hash',async t=>{
 const f=webhookFixture(),send=await webhookHarness(t,f);
 assert.equal((await send(null)).status,400);assert.equal((await send('bad')).status,400);assert.equal((await send('signed','x'.repeat(262145))).status,413);
 assert.equal(f.calls.filter(x=>x[0]!=='verify').length,0);assert.equal(f.actions.length,0);
 assert.equal((await send()).status,200);
 assert.deepEqual(f.calls[1],['verify',true,'signed','whsec_test']);
 assert.deepEqual(f.calls[2],['session','cs_1',{expand:['payment_intent.latest_charge']}]);
 assert.deepEqual(f.calls[3],['items','cs_1',{limit:2}]);
 const code=createHmac('sha256',secret).update('pdf2md|cs_1').digest('base64url');
 assert.equal(f.actions[0][1].codeHash,createHash('sha256').update(code).digest('hex'));
});
test('unpaid/unhandled no-op; mismatches persist coded alert before 200',async t=>{
 const f=webhookFixture(),send=await webhookHarness(t,f);
 f.session.payment_status='unpaid';assert.equal((await send()).status,200);assert.equal(f.actions.length,0);
 f.session.payment_status='paid';f.items.data[0].price.id='wrong';assert.equal((await send()).status,200);
 assert.deepEqual(f.actions.pop(),['alert',createHash('sha256').update('evt_1').digest('hex'),'price_mismatch']);
 f.items.data[0].price.id='price_fixed';f.session.customer_details=null;f.session.customer_email='untrusted@example.invalid';assert.equal((await send()).status,200);assert.equal(f.actions.at(-1)[2],'missing_email');
 f.setEvent({id:'evt_2',type:'other',data:{object:{}}});const n=f.actions.length;assert.equal((await send()).status,200);assert.equal(f.actions.length,n);
});
test('strict shapes reject paged items, string PI/charge, wrong amount and unrelated metadata',async t=>{
 const f=webhookFixture(),send=await webhookHarness(t,f);
 for(const [obj,key,value] of [[f.items,'has_more',true],[f.session,'payment_intent','pi_1'],[f.pi,'latest_charge','ch_1'],[f.session,'amount_total',201],[f.session.metadata,'subject_hash','invalid'],[f.charge,'payment_intent','pi_other']]) {
   const prior=obj[key];obj[key]=value;assert.equal((await send()).status,200);assert.equal(f.actions.at(-1)[0],'alert');obj[key]=prior;
 }
 assert.equal(f.actions.some(x=>x[0]==='fulfill'),false);
});
test('partial refund does not reverse, full/disputed before fulfillment tombstone and post-fulfillment flip revokes',async t=>{
 const f=webhookFixture(),send=await webhookHarness(t,f);
 f.charge.amount_refunded=50;assert.equal((await send()).status,200);assert.equal(f.actions.at(0)[0],'fulfill');
 f.actions.length=0;f.charge.amount_refunded=200;assert.equal((await send()).status,200);assert.deepEqual(f.actions,[['reverse','pi_1','refunded']]);
 f.actions.length=0;f.charge.amount_refunded=0;f.charge.disputed=true;assert.equal((await send()).status,200);assert.deepEqual(f.actions,[['reverse','pi_1','disputed']]);
 f.actions.length=0;f.charge.disputed=false;f.paygate.fulfillGuarded=async a=>{f.actions.push(['fulfill',a]);f.charge.refunded=true;return 'entitlement';};
 assert.equal((await send()).status,200);assert.deepEqual(f.actions.map(x=>x[0]),['fulfill','reverse']);
});
test('signed charge event re-fetches provider and scopes PI metadata; transient outages retry',async t=>{
 const f=webhookFixture(),send=await webhookHarness(t,f);
 f.setEvent({id:'evt_charge',type:'charge.refunded',data:{object:{id:'ch_1',payment_intent:'pi_1',refunded:true}}});
 f.charge.amount_refunded=50;assert.equal((await send()).status,200);assert.equal(f.actions.length,0);
 f.charge.amount_refunded=200;assert.equal((await send()).status,200);assert.deepEqual(f.actions,[['reverse','pi_1','refunded']]);
 f.actions.length=0;f.pi.metadata.app='other';assert.equal((await send()).status,200);assert.equal(f.actions.length,0);
 f.setEvent({id:'evt_1',type:'checkout.session.completed',data:{object:{id:'cs_1'}}});f.stripe.checkout.sessions.retrieve=async()=>{throw Error('private email');};
 const error=await send();assert.ok([500,503].includes(error.status));assert.doesNotMatch(error.body,/private|email/);
 f.stripe.checkout.sessions.retrieve=async()=>f.session;f.session.amount_total=201;f.paygate.recordAnomaly=async()=>{throw Error('private email');};
 assert.ok([500,503].includes((await send()).status));
});

test('dispute event re-fetches charge and writes tombstone; duplicate checkout NULL guard stays acknowledged',async t=>{
 const f=webhookFixture(),send=await webhookHarness(t,f);
 f.setEvent({id:'evt_dispute',type:'charge.dispute.created',data:{object:{charge:'ch_1'}}});
 f.charge.disputed=true;assert.equal((await send()).status,200);
 assert.deepEqual(f.actions,[['reverse','pi_1','disputed']]);
 f.actions.length=0;f.charge.disputed=false;
 f.setEvent({id:'evt_1',type:'checkout.session.async_payment_succeeded',data:{object:{id:'cs_1'}}});
 f.paygate.fulfillGuarded=async a=>{f.actions.push(['tombstoned',a]);return null;};
 assert.equal((await send()).status,200);assert.deepEqual(f.actions.map(x=>x[0]),['tombstoned']);
});

test('signed charge reversal never revokes a different-amount/currency charge, even at two euros refunded',async t=>{
 const f=webhookFixture(),send=await webhookHarness(t,f);
 f.setEvent({id:'evt_charge',type:'charge.refunded',data:{object:{id:'ch_1'}}});
 for (const [amount,currency] of [[400,'eur'],[200,'usd'],[undefined,'eur']]) {
   f.charge.amount=amount;f.charge.currency=currency;f.charge.amount_refunded=200;
   assert.equal((await send()).status,503);
   assert.equal(f.actions.some(a=>a[0]==='reverse'),false);
 }
 f.charge.amount=200;f.charge.currency='eur';
 assert.equal((await send()).status,200);
 assert.deepEqual(f.actions.at(-1),['reverse','pi_1','refunded']);
});

test('signed charge reversal retries when latest charge identity is unverified, without a tombstone',async t=>{
 const f=webhookFixture(),send=await webhookHarness(t,f);
 f.setEvent({id:'evt_charge',type:'charge.refunded',data:{object:{id:'ch_1'}}});
 f.charge.amount_refunded=200;
 for (const latest of [undefined,'ch_1',{id:'ch_other'}]) {
   f.pi.latest_charge=latest;
   assert.equal((await send()).status,503);
   assert.equal(f.actions.some(a=>a[0]==='reverse'),false);
 }
 f.pi.latest_charge=f.charge;
 assert.equal((await send()).status,200);
 assert.deepEqual(f.actions.at(-1),['reverse','pi_1','refunded']);
});

test('checkout pre/post reversal checks retry on invalid charge amount or currency without acknowledging',async t=>{
 const f=webhookFixture(),send=await webhookHarness(t,f);
 // Expanded checkout charge is valid; separately fetched current charge is not.
 f.pi.latest_charge={...f.charge};
 f.charge.amount=400;f.charge.amount_refunded=200;
 assert.equal((await send()).status,503);
 assert.deepEqual(f.actions,[]);
 f.charge.amount=200;f.charge.amount_refunded=0;
 f.paygate.fulfillGuarded=async a=>{f.actions.push(['fulfill',a]);f.charge.currency='usd';return 'entitlement';};
 assert.equal((await send()).status,503);
 assert.deepEqual(f.actions.map(a=>a[0]),['fulfill']);
});

test('reversal requires a succeeded, verified PaymentIntent before revocation',async t=>{
 const f=webhookFixture(),send=await webhookHarness(t,f);
 f.setEvent({id:'evt_dispute',type:'charge.dispute.created',data:{object:{charge:'ch_1'}}});
 f.charge.disputed=true;f.pi.status='requires_payment_method';
 assert.equal((await send()).status,503);
 assert.deepEqual(f.actions,[]);
 f.pi.status='succeeded';
 assert.equal((await send()).status,200);
 assert.deepEqual(f.actions,[['reverse','pi_1','disputed']]);
});
