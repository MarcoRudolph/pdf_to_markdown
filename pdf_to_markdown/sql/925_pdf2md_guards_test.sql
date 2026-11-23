-- Disposable handoff database ONLY. Requires base, seed, 020, 025 and 030; no real data survives.
BEGIN;
DO $$
DECLARE
  a text := repeat('a',64); b text := repeat('b',64); c text := repeat('c',64);
  d text := repeat('d',64); ip text := repeat('e',64);
  day_d date := (now() at time zone 'Europe/Berlin')::date;
  ent_a uuid; ent_b uuid;
BEGIN
  -- Synthetic unique refs; rollback removes all purchases and counter changes.
  ent_a := paygate.pdf2md_fulfill_guarded('synthetic@example.invalid','cs_test_guards_a','pi_test_guards_a',c,a,NULL);
  ent_b := paygate.pdf2md_fulfill_guarded('synthetic@example.invalid','cs_test_guards_b','pi_test_guards_b',d,b,NULL);
  ASSERT ent_a IS NOT NULL AND ent_b IS NOT NULL AND ent_a<>ent_b, 'separate passes';
  ASSERT paygate.redeem_pdf2md_entitlement(c,repeat('f',64),5)=1, 'redeem A';
  ASSERT paygate.redeem_pdf2md_entitlement(c,repeat('f',64),5)=1, 'idempotent redeem';
  ASSERT (SELECT count(*) FROM paygate.entitlement_subjects WHERE subject_hash=repeat('f',64) AND entitlement_id=ent_b)=0, 'same email B must remain inaccessible';
  ASSERT paygate.redeem_pdf2md_entitlement(repeat('0',64),repeat('f',64),5)=0, 'invalid code';
  ASSERT paygate.redeem_pdf2md_entitlement(d,repeat('f',64),1)=0, 'device cap';
  UPDATE paygate.entitlements SET expires_at=now()-interval '1 second' WHERE id=ent_b;
  ASSERT paygate.redeem_pdf2md_entitlement(d,repeat('f',64),5)=0, 'expired';
  ASSERT paygate.pdf2md_record_reversal('pi_test_guards_before','refunded'), 'refund-first tombstone';
  ASSERT paygate.pdf2md_fulfill_guarded('synthetic@example.invalid','cs_test_guards_before','pi_test_guards_before',repeat('1',64),a,NULL) IS NULL, 'no late pass';
  ASSERT paygate.pdf2md_record_reversal('pi_test_guards_a','refunded'), 'fulfill then reverse';
  ASSERT paygate.redeem_pdf2md_entitlement(c,repeat('f',64),5)=0, 'revoked';
  ASSERT NOT paygate.checkout_fulfilled('cs_test_guards_a',a), 'revoked status';
  ASSERT paygate.pdf2md_record_reversal('pi_test_guards_a','disputed'), 'dispute precedence';
  ASSERT paygate.pdf2md_record_reversal('pi_test_guards_a','refunded'), 'later refund cannot downgrade dispute';
  ASSERT (SELECT status FROM paygate.pdf2md_reversals WHERE payment_intent_id='pi_test_guards_a')='disputed', 'tombstone precedence';
  ASSERT (SELECT status FROM paygate.purchases WHERE stripe_ref='cs_test_guards_a')='disputed', 'purchase precedence';
  INSERT INTO paygate.free_usage(app_id,kind,key_hash,day,units) VALUES
    ('pdf2md','subject',a,day_d,1),('pdf2md','ip',ip,day_d,1),
    ('pdf2md','subject',a,day_d+1,1),('pdf2md','ip',ip,day_d+1,1);
  ASSERT paygate.refund_pdf2md_free_day(a,ip,day_d)=2, 'free saved-day refund';
  ASSERT (SELECT sum(units) FROM paygate.free_usage WHERE app_id='pdf2md' AND key_hash IN (a,ip) AND day=day_d)=0, 'D free zero';
  ASSERT (SELECT sum(units) FROM paygate.free_usage WHERE app_id='pdf2md' AND key_hash IN (a,ip) AND day=day_d+1)=2, 'D+1 free intact';
  INSERT INTO paygate.entitlement_usage(entitlement_id,bucket,units) VALUES(ent_b,day_d,1),(ent_b,day_d+1,1);
  ASSERT paygate.refund_pdf2md_paid_day(ent_b,day_d)=1, 'paid saved-day refund';
  ASSERT (SELECT units FROM paygate.entitlement_usage WHERE entitlement_id=ent_b AND bucket=day_d)=0, 'D paid zero';
  ASSERT (SELECT units FROM paygate.entitlement_usage WHERE entitlement_id=ent_b AND bucket=day_d+1)=1, 'D+1 paid intact';
  PERFORM paygate.pdf2md_record_anomaly(repeat('9',64),'missing_email');
  ASSERT (SELECT reason FROM paygate.pdf2md_webhook_anomalies WHERE event_hash=repeat('9',64))='missing_email', 'durable coded alert';
END $$;
-- A second app exposes a regression in any generic grant; everything rolls back.
INSERT INTO paygate.apps(id,name,free_units_per_day) VALUES('scope-probe','Scope probe',5);
SET ROLE paygate_pdf2md;
DO $$
DECLARE fn text; denied boolean;
BEGIN
  FOREACH fn IN ARRAY ARRAY['paygate.quota','paygate.consume_free','paygate.consume_paid'] LOOP
    denied := false;
    BEGIN
      IF fn = 'paygate.consume_paid' THEN
        PERFORM paygate.consume_paid('scope-probe',repeat('7',64));
      ELSE
        EXECUTE format('select %s(''scope-probe'',repeat(''7'',64),repeat(''8'',64))',fn);
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN denied := true;
    END;
    ASSERT denied, 'generic cross-app RPC executable: ' || fn;
  END LOOP;
  ASSERT paygate.quota_pdf2md(repeat('7',64),repeat('8',64)) IS NOT NULL, 'scoped quota';
  ASSERT paygate.consume_pdf2md_free(repeat('7',64),repeat('8',64)), 'scoped free';
  PERFORM paygate.consume_pdf2md_paid(repeat('7',64));
END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM paygate.free_usage WHERE app_id='scope-probe'), 'cross-app counter changed';
  ASSERT EXISTS (SELECT 1 FROM paygate.free_usage WHERE app_id='pdf2md' AND key_hash=repeat('7',64)), 'scoped counter missing';
END $$;
-- Dedicated role can execute only the intended RPCs and read only public configuration.
DO $$
DECLARE fn text;
BEGIN
  ASSERT has_table_privilege('paygate_pdf2md','paygate.apps','SELECT'), 'apps config';
  ASSERT has_table_privilege('paygate_pdf2md','paygate.products','SELECT'), 'products config';
  FOREACH fn IN ARRAY ARRAY[
    'paygate.quota_pdf2md(text,text)','paygate.consume_pdf2md_free(text,text)',
    'paygate.consume_pdf2md_paid(text)','paygate.checkout_fulfilled(text,text)',
    'paygate.pdf2md_fulfill_guarded(text,text,text,text,text,text)',
    'paygate.pdf2md_record_reversal(text,text)',
    'paygate.redeem_pdf2md_entitlement(text,text,int)',
    'paygate.refund_pdf2md_free_day(text,text,date)',
    'paygate.refund_pdf2md_paid_day(uuid,date)','paygate.pdf2md_record_anomaly(text,text)'
  ] LOOP
    ASSERT has_function_privilege('paygate_pdf2md',fn,'EXECUTE'), 'missing wrapper privilege';
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'paygate.fulfill_purchase(text,text,text,text,text,int,text,text,text,text,text,timestamptz)',
    'paygate.refund_purchase(text,text)','paygate.redeem_code(text,text,text,int)',
    'paygate.refund_free(text,text,text)','paygate.refund_paid(uuid)',
    'paygate.quota(text,text,text)','paygate.consume_free(text,text,text)',
    'paygate.consume_paid(text,text)'
  ] LOOP
    ASSERT NOT has_function_privilege('paygate_pdf2md',fn,'EXECUTE'), 'broad base function exposed';
  END LOOP;
  ASSERT NOT has_table_privilege('paygate_pdf2md','paygate.customers','SELECT'), 'customers exposed';
  ASSERT NOT has_table_privilege('paygate_pdf2md','paygate.purchases','SELECT'), 'purchases exposed';
  ASSERT NOT has_table_privilege('paygate_pdf2md','paygate.pdf2md_reversals','SELECT'), 'tombstones exposed';
  ASSERT NOT has_table_privilege('paygate_pdf2md','paygate.pdf2md_webhook_anomalies','SELECT'), 'alerts exposed';
END $$;
DO $$ BEGIN RAISE NOTICE 'PDF2MD GUARDS TEST PASSED'; END $$;
ROLLBACK;
