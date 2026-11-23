begin;
set local role paygate_owner;
create function paygate.checkout_fulfilled(p_stripe_ref text, p_subject_hash text)
returns boolean language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1 from paygate.purchases p
    join paygate.entitlements e on e.purchase_id = p.id
    join paygate.entitlement_subjects s on s.entitlement_id = e.id
    where p.stripe_ref = p_stripe_ref and p.app_id = 'pdf2md'
      and p.status = 'paid' and e.revoked_at is null
      and (e.expires_at is null or e.expires_at > now())
      and s.subject_hash = p_subject_hash
  );
$$;
revoke execute on function paygate.checkout_fulfilled(text,text) from public;
-- Task 5 creates the dedicated role and grants only it EXECUTE.
commit;
