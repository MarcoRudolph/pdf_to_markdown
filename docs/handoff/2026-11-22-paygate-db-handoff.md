---
description: "Handoff for the VPS agent: provision the generic 'paygate' PostgreSQL database (anonymous free quota + Stripe-paid stackable passes) shared by all small paid pages"
paths:
  - "../../pdf_to_markdown/server.cjs"
  - "../../API/app.py"
---

# Handoff: `paygate` database on the VPS

**Audience:** the agent operating the VPS. **Requested by:** Marco. **Date:** 2026-11-22.

## What this is

`paygate` is one small PostgreSQL database shared by several independent web pages
(first one: `pdf2md`, the PDF-to-Markdown converter). Every page follows the same pattern:

- Visitors are **anonymous**. A visitor gets a free daily quota, counted against a hashed
  browser id and a hashed IP. No account, no registration.
- A person is stored **only when they pay** (email from Stripe Checkout). A payment buys a
  **pass**: N units per day for a number of days (pdf2md: 2 EUR = 50 files/day for 30 days,
  files up to 10 MB). Buying again while a pass is active **stacks**: two passes = 100/day.
- All quota logic lives in SQL functions, so every new page reuses it by adding two rows.

Your job is only the database. Do not change any application, proxy, or Stripe setting.

## Ground rules

- Do not stop, restart, or reconfigure any service that is already running on the VPS.
- The database must never be reachable from the internet: bind to `127.0.0.1` only.
- Never write a password into Git, a chat message, a log, or your report. Report file paths only.
- Run every SQL file with `ON_ERROR_STOP=1`. If any step fails, stop and report the error verbatim.

---

## Task 1 — Provision a dedicated PostgreSQL 17 container

Create `/opt/paygate/compose.yaml` with the content below and a root-only `/opt/paygate/.env` (mode `600`) holding a freshly generated `POSTGRES_PASSWORD` (`openssl rand -hex 24`), then start it with `docker compose up -d`. Use a dedicated container even if another PostgreSQL or Supabase instance already exists on the VPS, and if host port `5433` is taken set `PAYGATE_PORT` in `.env` to the next free port. Done means `docker inspect -f '{{.State.Health.Status}}' paygate-db` prints `healthy` and `ss -ltnp` shows the port bound to `127.0.0.1` only.

```yaml
# /opt/paygate/compose.yaml
services:
  db:
    image: postgres:17-alpine
    container_name: paygate-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: paygate
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in /opt/paygate/.env}
    ports:
      - "127.0.0.1:${PAYGATE_PORT:-5433}:5432"
    volumes:
      - paygate-data:/var/lib/postgresql/data
    networks:
      - paygate-net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d paygate"]
      interval: 10s
      timeout: 5s
      retries: 6

volumes:
  paygate-data:

networks:
  paygate-net:
    name: paygate-net
```

## Task 2 — Apply the schema

Save the SQL block below unchanged as `/opt/paygate/sql/001_schema.sql` and apply it with `docker exec -i paygate-db psql -U postgres -d paygate -v ON_ERROR_STOP=1 < /opt/paygate/sql/001_schema.sql`. The file is a single transaction, so a failure leaves nothing behind, and a second run fails on purpose with `schema "paygate" already exists`. Done means `\dt paygate.*` lists 8 tables and `\df paygate.*` lists 9 functions.

```sql
-- file: 001_schema.sql
begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'paygate_owner') then
    create role paygate_owner nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'paygate_app') then
    create role paygate_app login;   -- no password yet: set in Task 3
  end if;
end $$;

grant paygate_owner to current_user;
create schema paygate authorization paygate_owner;
set local role paygate_owner;

-- Opaque keys only: lowercase hex SHA-256/HMAC. Rejects raw IPs, cookies, codes by construction.
create domain paygate.hash64 as text check (value ~ '^[0-9a-f]{64}$');

-- One row per page/site.
create table paygate.apps (
  id                    text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,30}$'),
  name                  text not null,
  timezone              text not null default 'Europe/Berlin',      -- defines when "a day" resets
  free_units_per_day    int  not null default 0 check (free_units_per_day >= 0),
  free_units_per_day_ip int  check (free_units_per_day_ip is null or free_units_per_day_ip > 0), -- null = no IP cap
  free_limits           jsonb not null default '{}',                -- app-specific, e.g. {"max_file_bytes": 1048576}
  active                boolean not null default true,
  created_at            timestamptz not null default now()
);

-- What can be bought. units + quota_period + valid_days describe the pass a purchase grants.
create table paygate.products (
  id              uuid primary key default gen_random_uuid(),
  app_id          text not null references paygate.apps(id),
  sku             text not null check (sku ~ '^[a-z0-9][a-z0-9-]{1,30}$'),
  name            text not null,
  amount_cents    int  not null check (amount_cents > 0),
  currency        text not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  stripe_price_id text,
  units           int  check (units is null or units > 0),          -- null = unlimited
  quota_period    text not null default 'day' check (quota_period in ('day', 'total')),
  valid_days      int  check (valid_days is null or valid_days > 0),-- null = never expires
  limits          jsonb not null default '{}',                      -- e.g. {"max_file_bytes": 10485760}
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (app_id, sku),
  check (units is not null or valid_days is not null)               -- never "unlimited forever"
);

-- A person. Created only by a successful payment. Shared across all apps.
create table paygate.customers (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null unique check (email = lower(email) and email like '_%@_%'),
  stripe_customer_id text unique,
  created_at         timestamptz not null default now()
);

-- One row per successful Stripe payment.
create table paygate.purchases (
  id                       uuid primary key default gen_random_uuid(),
  app_id                   text not null references paygate.apps(id),
  product_id               uuid not null references paygate.products(id),
  customer_id              uuid not null references paygate.customers(id),
  stripe_ref               text not null unique,   -- cs_... (one-time) or in_... (subscription invoice)
  stripe_payment_intent_id text unique,
  stripe_subscription_id   text,
  amount_cents             int  not null check (amount_cents >= 0),
  currency                 text not null check (currency ~ '^[a-z]{3}$'),
  status                   text not null default 'paid' check (status in ('paid', 'refunded', 'disputed')),
  paid_at                  timestamptz not null default now(),
  refunded_at              timestamptz
);
create index purchases_customer_idx on paygate.purchases (customer_id);
create index purchases_app_paid_idx on paygate.purchases (app_id, paid_at);

-- The pass a purchase grants. Several active passes for the same browser stack.
create table paygate.entitlements (
  id           uuid primary key default gen_random_uuid(),
  app_id       text not null references paygate.apps(id),
  purchase_id  uuid not null unique references paygate.purchases(id),
  code_hash    paygate.hash64 not null unique,   -- SHA-256 of the restore code shown to the buyer
  units        int  check (units is null or units > 0),
  quota_period text not null check (quota_period in ('day', 'total')),
  limits       jsonb not null default '{}',
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

-- Which anonymous browsers may use a pass (buyer's browser + devices restored by code).
create table paygate.entitlement_subjects (
  entitlement_id uuid not null references paygate.entitlements(id) on delete cascade,
  subject_hash   paygate.hash64 not null,
  bound_at       timestamptz not null default now(),
  primary key (entitlement_id, subject_hash)
);
create index entitlement_subjects_subject_idx on paygate.entitlement_subjects (subject_hash);

-- Paid usage counter. bucket = local day for 'day' passes, 1970-01-01 for 'total' passes.
create table paygate.entitlement_usage (
  entitlement_id uuid not null references paygate.entitlements(id) on delete cascade,
  bucket         date not null,
  units          int  not null default 0 check (units >= 0),
  primary key (entitlement_id, bucket)
);

-- Free usage counter per hashed browser id and per hashed IP. Purged after 7 days.
create table paygate.free_usage (
  app_id   text not null references paygate.apps(id),
  kind     text not null check (kind in ('subject', 'ip')),
  key_hash paygate.hash64 not null,
  day      date not null,
  units    int  not null default 0 check (units >= 0),
  primary key (app_id, kind, key_hash, day)
);

-- ---------------------------------------------------------------------------
-- Functions: the only write path for applications.
-- ---------------------------------------------------------------------------

-- Current allowance of a browser. Returns null for an unknown/inactive app.
create function paygate.quota(p_app text, p_subject_hash text, p_ip_hash text default null)
returns jsonb
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  with a as (
    select x.*, (now() at time zone x.timezone)::date as today
      from paygate.apps x
     where x.id = p_app and x.active
  )
  select jsonb_build_object(
    'free', jsonb_build_object(
      'units_left', greatest(0, least(
        a.free_units_per_day - coalesce((
          select u.units from paygate.free_usage u
           where u.app_id = a.id and u.kind = 'subject'
             and u.key_hash = p_subject_hash and u.day = a.today), 0),
        case when a.free_units_per_day_ip is null or p_ip_hash is null then null
             else a.free_units_per_day_ip - coalesce((
               select u.units from paygate.free_usage u
                where u.app_id = a.id and u.kind = 'ip'
                  and u.key_hash = p_ip_hash and u.day = a.today), 0)
        end)),
      'limits', a.free_limits),
    'paid', coalesce((
      select jsonb_agg(jsonb_build_object(
               'entitlement_id', e.id,
               'units_left', e.units - coalesce(u.units, 0),
               'quota_period', e.quota_period,
               'limits', e.limits,
               'expires_at', e.expires_at)
             order by e.expires_at nulls last, e.created_at)
        from paygate.entitlements e
        join paygate.entitlement_subjects s on s.entitlement_id = e.id
        left join paygate.entitlement_usage u
               on u.entitlement_id = e.id
              and u.bucket = case when e.quota_period = 'day' then a.today else date '1970-01-01' end
       where e.app_id = a.id
         and s.subject_hash = p_subject_hash
         and e.revoked_at is null
         and (e.expires_at is null or e.expires_at > now())
    ), '[]'::jsonb))
  from a
$$;

-- Atomically take 1 free unit. false = daily free quota (browser or IP) is used up.
create function paygate.consume_free(p_app text, p_subject_hash text, p_ip_hash text default null)
returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_app paygate.apps%rowtype;
  v_day date;
begin
  select * into v_app from paygate.apps where id = p_app and active;
  if not found then
    raise exception 'paygate: unknown or inactive app %', p_app;
  end if;
  if v_app.free_units_per_day = 0 then
    return false;
  end if;
  v_day := (now() at time zone v_app.timezone)::date;

  insert into paygate.free_usage as u (app_id, kind, key_hash, day, units)
  values (p_app, 'subject', p_subject_hash, v_day, 1)
  on conflict (app_id, kind, key_hash, day) do update
    set units = u.units + 1
    where u.units < v_app.free_units_per_day;
  if not found then
    return false;
  end if;

  if v_app.free_units_per_day_ip is not null and p_ip_hash is not null then
    insert into paygate.free_usage as u (app_id, kind, key_hash, day, units)
    values (p_app, 'ip', p_ip_hash, v_day, 1)
    on conflict (app_id, kind, key_hash, day) do update
      set units = u.units + 1
      where u.units < v_app.free_units_per_day_ip;
    if not found then
      update paygate.free_usage f
         set units = f.units - 1
       where f.app_id = p_app and f.kind = 'subject'
         and f.key_hash = p_subject_hash and f.day = v_day;
      return false;
    end if;
  end if;
  return true;
end $$;

-- Give a free unit back (the paid-for action failed).
create function paygate.refund_free(p_app text, p_subject_hash text, p_ip_hash text default null)
returns void
language sql security definer set search_path = pg_catalog, pg_temp
as $$
  update paygate.free_usage u
     set units = u.units - 1
    from paygate.apps a
   where a.id = p_app
     and u.app_id = a.id
     and u.day = (now() at time zone a.timezone)::date
     and u.units > 0
     and ((u.kind = 'subject' and u.key_hash = p_subject_hash)
       or (u.kind = 'ip' and u.key_hash = p_ip_hash));
$$;

-- Atomically take 1 unit from the browser's active passes (soonest-expiring first).
-- Returns {"entitlement_id","limits","units_left","expires_at"} or null if nothing is left.
create function paygate.consume_paid(p_app text, p_subject_hash text)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_tz     text;
  v_day    date;
  v_pass   record;
  v_bucket date;
  v_used   int;
begin
  select a.timezone into v_tz from paygate.apps a where a.id = p_app and a.active;
  if not found then
    raise exception 'paygate: unknown or inactive app %', p_app;
  end if;
  v_day := (now() at time zone v_tz)::date;

  for v_pass in
    select e.id, e.units, e.quota_period, e.limits, e.expires_at
      from paygate.entitlements e
      join paygate.entitlement_subjects s on s.entitlement_id = e.id
     where e.app_id = p_app
       and s.subject_hash = p_subject_hash
       and e.revoked_at is null
       and (e.expires_at is null or e.expires_at > now())
     order by e.expires_at nulls last, e.created_at
  loop
    v_bucket := case when v_pass.quota_period = 'day' then v_day else date '1970-01-01' end;
    insert into paygate.entitlement_usage as u (entitlement_id, bucket, units)
    values (v_pass.id, v_bucket, 1)
    on conflict (entitlement_id, bucket) do update
      set units = u.units + 1
      where v_pass.units is null or u.units < v_pass.units
    returning u.units into v_used;
    if found then
      return jsonb_build_object(
        'entitlement_id', v_pass.id,
        'limits', v_pass.limits,
        'units_left', v_pass.units - v_used,
        'expires_at', v_pass.expires_at);
    end if;
  end loop;
  return null;
end $$;

-- Give a paid unit back (the paid-for action failed).
create function paygate.refund_paid(p_entitlement_id uuid)
returns void
language sql security definer set search_path = pg_catalog, pg_temp
as $$
  update paygate.entitlement_usage u
     set units = u.units - 1
   where u.entitlement_id = p_entitlement_id
     and u.units > 0
     and u.bucket = (
       select case when e.quota_period = 'day'
                   then (now() at time zone a.timezone)::date
                   else date '1970-01-01' end
         from paygate.entitlements e
         join paygate.apps a on a.id = e.app_id
        where e.id = p_entitlement_id);
$$;

-- Called from the Stripe webhook once a payment is confirmed paid. Idempotent on p_stripe_ref.
-- Creates/updates the customer, records the purchase, grants the pass, binds the buyer's browser.
create function paygate.fulfill_purchase(
  p_app                    text,
  p_sku                    text,
  p_email                  text,
  p_stripe_ref             text,
  p_payment_intent_id      text,
  p_amount_cents           int,
  p_currency               text,
  p_code_hash              text,
  p_subject_hash           text default null,
  p_stripe_customer_id     text default null,
  p_stripe_subscription_id text default null,
  p_expires_at             timestamptz default null   -- override; default = now() + product.valid_days
) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_product  paygate.products%rowtype;
  v_customer uuid;
  v_purchase uuid;
  v_ent      uuid;
begin
  select e.id into v_ent
    from paygate.purchases p
    join paygate.entitlements e on e.purchase_id = p.id
   where p.stripe_ref = p_stripe_ref;
  if v_ent is not null then
    return v_ent;
  end if;

  select * into v_product from paygate.products where app_id = p_app and sku = p_sku;
  if not found then
    raise exception 'paygate: unknown product %/%', p_app, p_sku;
  end if;

  insert into paygate.customers as c (email, stripe_customer_id)
  values (lower(btrim(p_email)), p_stripe_customer_id)
  on conflict (email) do update
    set stripe_customer_id = coalesce(excluded.stripe_customer_id, c.stripe_customer_id)
  returning c.id into v_customer;

  insert into paygate.purchases
    (app_id, product_id, customer_id, stripe_ref, stripe_payment_intent_id,
     stripe_subscription_id, amount_cents, currency)
  values
    (p_app, v_product.id, v_customer, p_stripe_ref, p_payment_intent_id,
     p_stripe_subscription_id, p_amount_cents, lower(p_currency))
  on conflict (stripe_ref) do nothing
  returning id into v_purchase;

  if v_purchase is null then   -- a concurrent delivery of the same event won the race
    select e.id into v_ent
      from paygate.purchases p
      join paygate.entitlements e on e.purchase_id = p.id
     where p.stripe_ref = p_stripe_ref;
    return v_ent;
  end if;

  insert into paygate.entitlements (app_id, purchase_id, code_hash, units, quota_period, limits, expires_at)
  values (
    p_app, v_purchase, p_code_hash, v_product.units, v_product.quota_period, v_product.limits,
    coalesce(p_expires_at,
             case when v_product.valid_days is null then null
                  else now() + make_interval(days => v_product.valid_days) end))
  returning id into v_ent;

  if p_subject_hash is not null then
    insert into paygate.entitlement_subjects (entitlement_id, subject_hash)
    values (v_ent, p_subject_hash);
  end if;
  return v_ent;
end $$;

-- Restore on another browser: any restore code of a customer binds ALL of that customer's
-- active passes for the app. Returns the number of passes now usable (0 = invalid code / device cap).
create function paygate.redeem_code(
  p_app text, p_code_hash text, p_subject_hash text, p_max_subjects int default 5
) returns int
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_customer uuid;
  v_pass     record;
  v_count    int := 0;
begin
  select p.customer_id into v_customer
    from paygate.entitlements e
    join paygate.purchases p on p.id = e.purchase_id
   where e.app_id = p_app and e.code_hash = p_code_hash and e.revoked_at is null;
  if v_customer is null then
    return 0;
  end if;

  for v_pass in
    select e.id
      from paygate.entitlements e
      join paygate.purchases p on p.id = e.purchase_id
     where e.app_id = p_app
       and p.customer_id = v_customer
       and e.revoked_at is null
       and (e.expires_at is null or e.expires_at > now())
     order by e.created_at
       for update of e
  loop
    if exists (select 1 from paygate.entitlement_subjects s
                where s.entitlement_id = v_pass.id and s.subject_hash = p_subject_hash) then
      v_count := v_count + 1;
    elsif (select count(*) from paygate.entitlement_subjects s
            where s.entitlement_id = v_pass.id) < p_max_subjects then
      insert into paygate.entitlement_subjects (entitlement_id, subject_hash)
      values (v_pass.id, p_subject_hash);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

-- Called from the Stripe webhook on a full refund or a dispute. Revokes the pass. Idempotent.
create function paygate.refund_purchase(p_payment_intent_id text, p_status text default 'refunded')
returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_purchase uuid;
begin
  update paygate.purchases
     set status = p_status, refunded_at = now()
   where stripe_payment_intent_id = p_payment_intent_id and status = 'paid'
  returning id into v_purchase;
  if v_purchase is null then
    return false;
  end if;
  update paygate.entitlements set revoked_at = now()
   where purchase_id = v_purchase and revoked_at is null;
  return true;
end $$;

-- Housekeeping: drop free-tier counters older than 7 days. Returns deleted row count.
create function paygate.purge_free_usage()
returns int
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_deleted int;
begin
  delete from paygate.free_usage where day < current_date - 7;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges: applications may read config and call functions, nothing else.
-- ---------------------------------------------------------------------------
revoke all on schema paygate from public;
revoke execute on all functions in schema paygate from public;
grant usage on schema paygate to paygate_app;
grant select on paygate.apps, paygate.products to paygate_app;
grant execute on all functions in schema paygate to paygate_app;

commit;
```

## Task 3 — Give the application role a password

Generate a second secret with `openssl rand -hex 24`, append it to `/opt/paygate/.env` as `PAYGATE_APP_PASSWORD`, and set it with `alter role paygate_app password '<value>'` followed by `revoke all on database paygate from public; grant connect on database paygate to paygate_app;`. Append the ready-to-use line `PAYGATE_DATABASE_URL=postgresql://paygate_app:<value>@127.0.0.1:<port>/paygate` to the same `.env` so application deployments can source it. Done means `psql "$PAYGATE_DATABASE_URL" -c "select paygate.quota('nope', repeat('a',64))"` connects and returns one empty (null) row.

## Task 4 — Seed the first page (`pdf2md`)

Save the block below as `/opt/paygate/sql/010_seed_pdf2md.sql` and apply it the same way as Task 2. It registers the PDF converter with 5 free files per day up to 1 MB (15 per IP) and one product: 2 EUR for 50 files per day up to 10 MB, valid 30 days. Done means `select id, free_units_per_day from paygate.apps` returns `pdf2md | 5` and `select sku, units, quota_period, valid_days from paygate.products` returns `pass50 | 50 | day | 30`.

```sql
-- file: 010_seed_pdf2md.sql
begin;

insert into paygate.apps (id, name, free_units_per_day, free_units_per_day_ip, free_limits)
values ('pdf2md', 'PDF to Markdown', 5, 15, '{"max_file_bytes": 1048576}')
on conflict (id) do nothing;

insert into paygate.products (app_id, sku, name, amount_cents, currency, units, quota_period, valid_days, limits)
values ('pdf2md', 'pass50', '50 PDFs per day up to 10 MB, 30 days', 200, 'eur', 50, 'day', 30,
        '{"max_file_bytes": 10485760}')
on conflict (app_id, sku) do nothing;

commit;
```

## Task 5 — Run the smoke test

Save the block below as `/opt/paygate/sql/900_smoke_test.sql` and run it as `postgres` the same way as Task 2. It exercises free quota, IP cap, purchase idempotency, stacking, daily reset, restore by code, expiry, refund, and the privilege boundary inside one transaction that is rolled back, so it leaves no data. Done means the output contains `NOTICE:  PAYGATE SMOKE TEST PASSED` and `select count(*) from paygate.customers` is still `0`.

```sql
-- file: 900_smoke_test.sql
begin;

insert into paygate.apps (id, name, free_units_per_day, free_units_per_day_ip, free_limits)
values ('smoke-test', 'Smoke test', 2, 3, '{"max_file_bytes": 1048576}');
insert into paygate.products (app_id, sku, name, amount_cents, units, quota_period, valid_days, limits)
values ('smoke-test', 'pass3', 'Day pass 3', 200, 3, 'day', 30, '{"max_file_bytes": 10485760}'),
       ('smoke-test', 'pack2', 'Pack of 2', 100, 2, 'total', null, '{}');

do $$
declare
  s1 text := repeat('a', 64);   -- buyer's browser
  s2 text := repeat('b', 64);   -- second browser, same IP
  s3 text := repeat('e', 64);   -- restored device
  ip text := repeat('c', 64);
  c1 text := repeat('1', 64);
  c2 text := repeat('2', 64);
  c3 text := repeat('3', 64);
  e1 uuid; e2 uuid; e3 uuid;
  q  jsonb; r jsonb;
begin
  -- free tier: 2 per browser, 3 per IP
  assert paygate.consume_free('smoke-test', s1, ip), 'free 1';
  assert paygate.consume_free('smoke-test', s1, ip), 'free 2';
  assert not paygate.consume_free('smoke-test', s1, ip), 'free 3 must be denied';
  assert paygate.consume_free('smoke-test', s2, ip), 'third unit on same IP';
  assert not paygate.consume_free('smoke-test', s2, ip), 'IP cap must deny';
  q := paygate.quota('smoke-test', s2, repeat('f', 64));
  assert (q->'free'->>'units_left')::int = 1, 'IP denial must not burn the browser counter';
  assert (paygate.quota('smoke-test', s2, ip)->'free'->>'units_left')::int = 0, 'IP cap visible in quota';
  perform paygate.refund_free('smoke-test', s1, ip);
  assert paygate.consume_free('smoke-test', s1, ip), 'refund frees one unit';
  assert paygate.quota('nope', s1) is null, 'unknown app';

  -- purchase: idempotent, email normalised
  e1 := paygate.fulfill_purchase('smoke-test', 'pass3', ' Buyer@Example.com ', 'cs_test_1', 'pi_test_1', 200, 'EUR', c1, s1);
  assert e1 = paygate.fulfill_purchase('smoke-test', 'pass3', 'buyer@example.com', 'cs_test_1', 'pi_test_1', 200, 'eur', c1, s1), 'idempotent';
  assert (select count(*) from paygate.purchases where app_id = 'smoke-test') = 1, 'one purchase';
  assert (select email from paygate.customers) = 'buyer@example.com', 'email normalised';

  -- one pass = 3 per day
  for i in 1..3 loop
    r := paygate.consume_paid('smoke-test', s1);
    assert (r->>'entitlement_id')::uuid = e1, 'paid unit from pass 1';
  end loop;
  assert (r->>'units_left')::int = 0, 'units_left reported';
  assert (r->'limits'->>'max_file_bytes')::bigint = 10485760, 'limits snapshot';
  assert paygate.consume_paid('smoke-test', s1) is null, 'pass 1 exhausted today';

  -- top-up: second pass stacks (+3 per day)
  e2 := paygate.fulfill_purchase('smoke-test', 'pass3', 'buyer@example.com', 'cs_test_2', 'pi_test_2', 200, 'eur', c2, s1);
  assert e2 <> e1, 'second pass';
  assert (select count(*) from paygate.customers) = 1, 'same customer';
  for i in 1..3 loop
    r := paygate.consume_paid('smoke-test', s1);
    assert (r->>'entitlement_id')::uuid = e2, 'paid unit from pass 2';
  end loop;
  assert paygate.consume_paid('smoke-test', s1) is null, 'both passes exhausted today';
  q := paygate.quota('smoke-test', s1, ip);
  assert jsonb_array_length(q->'paid') = 2, 'quota lists both passes';

  -- next day: counters reset
  update paygate.entitlement_usage set bucket = bucket - 1;
  q := paygate.quota('smoke-test', s1, ip);
  assert (q->'paid'->0->>'units_left')::int = 3 and (q->'paid'->1->>'units_left')::int = 3, 'daily reset';
  r := paygate.consume_paid('smoke-test', s1);
  assert r is not null, 'usable again next day';
  perform paygate.refund_paid((r->>'entitlement_id')::uuid);
  q := paygate.quota('smoke-test', s1, ip);
  assert (q->'paid'->0->>'units_left')::int = 3, 'paid refund';

  -- restore on another device: one code binds all passes of the customer
  assert paygate.consume_paid('smoke-test', s3) is null, 'unknown device has no pass';
  assert paygate.redeem_code('smoke-test', repeat('0', 64), s3) = 0, 'invalid code';
  assert paygate.redeem_code('smoke-test', c1, s3) = 2, 'code restores both passes';
  assert paygate.redeem_code('smoke-test', c1, s3) = 2, 'redeem is idempotent';
  assert paygate.redeem_code('smoke-test', c1, s2, 2) = 0, 'device cap';
  assert paygate.consume_paid('smoke-test', s3) is not null, 'restored device can consume';

  -- expiry and refund
  update paygate.entitlements set expires_at = now() - interval '1 second' where id = e2;
  assert jsonb_array_length(paygate.quota('smoke-test', s1)->'paid') = 1, 'expired pass hidden';
  assert paygate.refund_purchase('pi_test_1'), 'refund';
  assert not paygate.refund_purchase('pi_test_1'), 'refund idempotent';
  assert paygate.consume_paid('smoke-test', s3) is null, 'revoked + expired => nothing left';

  -- 'total' pack: 2 units, no daily reset
  e3 := paygate.fulfill_purchase('smoke-test', 'pack2', 'other@example.com', 'cs_test_3', 'pi_test_3', 100, 'eur', c3, s2);
  assert paygate.consume_paid('smoke-test', s2) is not null, 'pack 1';
  assert paygate.consume_paid('smoke-test', s2) is not null, 'pack 2';
  assert paygate.consume_paid('smoke-test', s2) is null, 'pack exhausted';
  assert (select expires_at from paygate.entitlements where id = e3) is null, 'pack never expires';
end $$;

-- privilege boundary: the app role can call functions and read config, but not tables with personal data
set local role paygate_app;
do $$
begin
  perform 1 from paygate.apps;
  perform paygate.quota('smoke-test', repeat('a', 64));
  begin
    perform 1 from paygate.customers;
    raise exception 'paygate_app must not read paygate.customers';
  exception when insufficient_privilege then null;
  end;
  begin
    update paygate.entitlement_usage set units = 0;
    raise exception 'paygate_app must not write paygate.entitlement_usage';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PAYGATE SMOKE TEST PASSED';
end $$;

rollback;
```

## Task 6 — Backups and housekeeping

Create `/opt/paygate/maintenance.sh` (mode `700`) from the block below and schedule it daily at 03:30 via `/etc/cron.d/paygate` running as root. It writes a compressed dump to `/opt/paygate/backups`, deletes dumps older than 14 days, and purges free-tier counters older than 7 days. Done means one manual run exits `0` and leaves a non-empty `paygate-<date>.dump` that `pg_restore --list` can read.

```bash
#!/usr/bin/env bash
# /opt/paygate/maintenance.sh
set -euo pipefail
mkdir -p /opt/paygate/backups
chmod 700 /opt/paygate/backups
docker exec paygate-db pg_dump -U postgres -Fc paygate > "/opt/paygate/backups/paygate-$(date +%F).dump"
find /opt/paygate/backups -name 'paygate-*.dump' -mtime +14 -delete
docker exec paygate-db psql -U postgres -d paygate -v ON_ERROR_STOP=1 -c "select paygate.purge_free_usage()" > /dev/null
```

```
# /etc/cron.d/paygate
30 3 * * * root /opt/paygate/maintenance.sh
```

## Report back to Marco

1. PostgreSQL version, container name, and the host port actually used.
2. Output of the Task 2, 4 and 5 "done" checks (verbatim).
3. Path of the env file that holds the secrets (never the values).
4. Anything you skipped or changed versus this document, and why.
5. The backups stay on the same VPS; say so explicitly, an off-site copy is not part of this task.

---

## Reference (for whoever wires a page to this database)

### Data model

| Table | Holds | Personal data |
|---|---|---|
| `apps` | one row per page: free quota, free limits, timezone | no |
| `products` | what a page sells: price, units, period, validity, limits | no |
| `customers` | email + Stripe customer id, created only by a payment | **yes** |
| `purchases` | one row per paid Stripe payment | linked |
| `entitlements` | the pass a purchase grants (units, period, expiry, restore-code hash) | linked |
| `entitlement_subjects` | hashed browser ids allowed to use a pass | pseudonymous |
| `entitlement_usage` | units used per pass per day | no |
| `free_usage` | free units used per hashed browser id / hashed IP per day (7 days) | pseudonymous |

### Values the application must hash before calling

| Parameter | Compute as |
|---|---|
| `p_subject_hash` | `hex(sha256(browser_id))`, where `browser_id` is a random 128-bit id in a signed HttpOnly cookie |
| `p_ip_hash` | `hex(hmac_sha256(server_secret, client_ip + "|" + yyyy-mm-dd))` |
| `p_code_hash` | `hex(sha256(restore_code))`, where the restore code has at least 128 bits of entropy |

### Per-request flow

1. `select paygate.quota(app, subject, ip)` to show remaining units and pick the size limit.
2. If the request fits `free.limits` and `free.units_left > 0`: `select paygate.consume_free(app, subject, ip)`.
3. Otherwise, or if step 2 returned `false`: `select paygate.consume_paid(app, subject)`; `null` means "pay first" (HTTP 402).
4. If the paid-for action then fails: `refund_free(app, subject, ip)` or `refund_paid(entitlement_id)`.

### Stripe webhook mapping

| Stripe event | Call |
|---|---|
| `checkout.session.completed` / `checkout.session.async_payment_succeeded` with `payment_status = 'paid'` | `fulfill_purchase(app, sku, email, session.id, payment_intent, amount_total, currency, code_hash, subject_hash)` |
| `charge.refunded` (full refund) | `refund_purchase(payment_intent)` |
| `charge.dispute.created` | `refund_purchase(payment_intent, 'disputed')` |
| *(optional, if a page later uses a real subscription)* `invoice.paid` | `fulfill_purchase(..., p_stripe_ref => invoice.id, p_stripe_subscription_id => sub.id, p_expires_at => period_end)` |

`subject_hash` and `code_hash` travel through Checkout in `metadata`; `fulfill_purchase` is idempotent on `stripe_ref`, so webhook retries are safe.

### Adding another page

Insert one row into `paygate.apps` and one row per offer into `paygate.products` (copy `010_seed_pdf2md.sql`). No schema change, no new role.

### Deliberate behaviour

- Each purchase is its own pass with its own expiry; a top-up bought on day 10 runs until day 40.
- "A day" ends at midnight in `apps.timezone` (default `Europe/Berlin`).
- Passes are consumed soonest-expiring first; the daily counter is per pass, so sharing a restore code does not multiply the quota.
- A daily pass that is not used does not carry units over to the next day.
