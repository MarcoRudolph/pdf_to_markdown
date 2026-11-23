-- Operator-reviewed follow-on migration; apply only after base schema and 020 checkout status.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paygate_pdf2md') THEN
    CREATE ROLE paygate_pdf2md LOGIN;
  END IF;
END $$;
GRANT CONNECT ON DATABASE paygate TO paygate_pdf2md;
SET LOCAL ROLE paygate_owner;
GRANT USAGE ON SCHEMA paygate TO paygate_pdf2md;
GRANT SELECT ON paygate.apps, paygate.products TO paygate_pdf2md;
CREATE TABLE paygate.pdf2md_reversals (
  payment_intent_id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('refunded','disputed')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE paygate.pdf2md_webhook_anomalies (
  event_hash paygate.hash64 PRIMARY KEY,
  reason text NOT NULL CHECK (reason IN ('price_mismatch','metadata_mismatch','missing_email','invalid_provider_shape')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON paygate.pdf2md_reversals, paygate.pdf2md_webhook_anomalies FROM PUBLIC;

CREATE FUNCTION paygate.pdf2md_fulfill_guarded(p_email text,p_stripe_ref text,p_payment_intent_id text,p_code_hash text,p_subject_hash text,p_stripe_customer_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF nullif(btrim(p_email),'') IS NULL OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR nullif(btrim(p_stripe_ref),'') IS NULL OR nullif(btrim(p_payment_intent_id),'') IS NULL
     OR p_code_hash !~ '^[0-9a-f]{64}$' OR p_subject_hash !~ '^[0-9a-f]{64}$'
     OR p_code_hash IS NULL OR p_subject_hash IS NULL THEN RAISE EXCEPTION 'invalid pdf2md fulfillment arguments'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pdf2md|'||p_payment_intent_id,0));
  IF EXISTS (SELECT 1 FROM paygate.pdf2md_reversals WHERE payment_intent_id=p_payment_intent_id) THEN RETURN NULL; END IF;
  RETURN paygate.fulfill_purchase('pdf2md','pass50',p_email,p_stripe_ref,p_payment_intent_id,200,'eur',p_code_hash,p_subject_hash,p_stripe_customer_id);
END $$;
REVOKE EXECUTE ON FUNCTION paygate.pdf2md_fulfill_guarded(text,text,text,text,text,text) FROM PUBLIC;

CREATE FUNCTION paygate.pdf2md_record_reversal(p_payment_intent_id text,p_status text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE effective_status text;
BEGIN
  IF nullif(btrim(p_payment_intent_id),'') IS NULL OR p_status IS NULL OR p_status NOT IN ('refunded','disputed') THEN
    RAISE EXCEPTION 'invalid pdf2md reversal arguments'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pdf2md|'||p_payment_intent_id,0));
  INSERT INTO paygate.pdf2md_reversals AS r (payment_intent_id,status) VALUES (p_payment_intent_id,p_status)
    ON CONFLICT (payment_intent_id) DO UPDATE SET status=CASE WHEN r.status='disputed' OR excluded.status='disputed' THEN 'disputed' ELSE 'refunded' END
    RETURNING status INTO effective_status;
  IF EXISTS (SELECT 1 FROM paygate.purchases WHERE stripe_payment_intent_id=p_payment_intent_id AND app_id<>'pdf2md') THEN
    RAISE EXCEPTION 'payment intent belongs to another app';
  END IF;
  PERFORM paygate.refund_purchase(p_payment_intent_id,effective_status);
  -- Base refund_purchase only changes paid rows; a later dispute must upgrade refunded status.
  IF effective_status='disputed' THEN
    UPDATE paygate.purchases SET status='disputed',refunded_at=COALESCE(refunded_at,now())
     WHERE app_id='pdf2md' AND stripe_payment_intent_id=p_payment_intent_id AND status='refunded';
  END IF;
  RETURN true;
END $$;
REVOKE EXECUTE ON FUNCTION paygate.pdf2md_record_reversal(text,text) FROM PUBLIC;

CREATE FUNCTION paygate.redeem_pdf2md_entitlement(p_code_hash text,p_subject_hash text,p_max_subjects int)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_ent uuid;
BEGIN
  IF p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' OR p_subject_hash IS NULL OR p_subject_hash !~ '^[0-9a-f]{64}$'
     OR p_max_subjects IS NULL OR p_max_subjects NOT BETWEEN 1 AND 5 THEN RETURN 0; END IF;
  SELECT e.id INTO v_ent FROM paygate.entitlements e
    JOIN paygate.purchases p ON p.id=e.purchase_id
    WHERE e.app_id='pdf2md' AND p.app_id='pdf2md' AND p.status='paid'
      AND e.code_hash=p_code_hash AND e.revoked_at IS NULL AND (e.expires_at IS NULL OR e.expires_at>now())
    FOR UPDATE OF e;
  IF v_ent IS NULL THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM paygate.entitlement_subjects WHERE entitlement_id=v_ent AND subject_hash=p_subject_hash) THEN RETURN 1; END IF;
  IF (SELECT count(*) FROM paygate.entitlement_subjects WHERE entitlement_id=v_ent)>=p_max_subjects THEN RETURN 0; END IF;
  INSERT INTO paygate.entitlement_subjects(entitlement_id,subject_hash) VALUES(v_ent,p_subject_hash);
  RETURN 1;
END $$;
REVOKE EXECUTE ON FUNCTION paygate.redeem_pdf2md_entitlement(text,text,int) FROM PUBLIC;

CREATE FUNCTION paygate.refund_pdf2md_free_day(p_subject_hash text,p_ip_hash text,p_day date)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE n int;
BEGIN
  IF p_day IS NULL OR p_subject_hash IS NULL OR p_subject_hash !~ '^[0-9a-f]{64}$'
    OR p_ip_hash IS NULL OR p_ip_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid pdf2md free refund'; END IF;
  UPDATE paygate.free_usage SET units=units-1 WHERE app_id='pdf2md' AND day=p_day AND units>0
    AND ((kind='subject' AND key_hash=p_subject_hash) OR (kind='ip' AND key_hash=p_ip_hash));
  GET DIAGNOSTICS n=ROW_COUNT;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION paygate.refund_pdf2md_free_day(text,text,date) FROM PUBLIC;
CREATE FUNCTION paygate.refund_pdf2md_paid_day(p_entitlement_id uuid,p_day date)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE n int;
BEGIN
  IF p_entitlement_id IS NULL OR p_day IS NULL THEN RAISE EXCEPTION 'invalid pdf2md paid refund'; END IF;
  UPDATE paygate.entitlement_usage u SET units=u.units-1 FROM paygate.entitlements e
    WHERE u.entitlement_id=e.id AND e.id=p_entitlement_id AND e.app_id='pdf2md'
      AND e.quota_period='day' AND u.bucket=p_day AND u.units>0;
  GET DIAGNOSTICS n=ROW_COUNT;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION paygate.refund_pdf2md_paid_day(uuid,date) FROM PUBLIC;
CREATE FUNCTION paygate.pdf2md_record_anomaly(p_event_hash text,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF p_event_hash IS NULL OR p_event_hash !~ '^[0-9a-f]{64}$' OR p_reason IS NULL
    OR p_reason NOT IN ('price_mismatch','metadata_mismatch','missing_email','invalid_provider_shape') THEN
    RAISE EXCEPTION 'invalid pdf2md anomaly'; END IF;
  INSERT INTO paygate.pdf2md_webhook_anomalies(event_hash,reason) VALUES (p_event_hash,p_reason)
    ON CONFLICT (event_hash) DO UPDATE SET reason=excluded.reason;
END $$;
REVOKE EXECUTE ON FUNCTION paygate.pdf2md_record_anomaly(text,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION paygate.quota(text,text,text), paygate.consume_free(text,text,text),
  paygate.consume_paid(text,text), paygate.checkout_fulfilled(text,text),
  paygate.pdf2md_fulfill_guarded(text,text,text,text,text,text), paygate.pdf2md_record_reversal(text,text),
  paygate.redeem_pdf2md_entitlement(text,text,int), paygate.refund_pdf2md_free_day(text,text,date),
  paygate.refund_pdf2md_paid_day(uuid,date), paygate.pdf2md_record_anomaly(text,text) TO paygate_pdf2md;
COMMIT;
