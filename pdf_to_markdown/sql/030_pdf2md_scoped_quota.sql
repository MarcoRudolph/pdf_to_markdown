-- Apply after 025 on the approved paygate DB. No generic app-ID RPC for the PDF role.
BEGIN;
SET LOCAL ROLE paygate_owner;

CREATE FUNCTION paygate.quota_pdf2md(p_subject_hash text, p_ip_hash text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$ SELECT paygate.quota('pdf2md', p_subject_hash, p_ip_hash) $$;
CREATE FUNCTION paygate.consume_pdf2md_free(p_subject_hash text, p_ip_hash text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$ SELECT paygate.consume_free('pdf2md', p_subject_hash, p_ip_hash) $$;
CREATE FUNCTION paygate.consume_pdf2md_paid(p_subject_hash text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$ SELECT paygate.consume_paid('pdf2md', p_subject_hash) $$;

REVOKE ALL ON FUNCTION paygate.quota_pdf2md(text,text),
  paygate.consume_pdf2md_free(text,text), paygate.consume_pdf2md_paid(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION paygate.quota(text,text,text),
  paygate.consume_free(text,text,text), paygate.consume_paid(text,text) FROM paygate_pdf2md;
GRANT EXECUTE ON FUNCTION paygate.quota_pdf2md(text,text),
  paygate.consume_pdf2md_free(text,text), paygate.consume_pdf2md_paid(text) TO paygate_pdf2md;
COMMIT;
