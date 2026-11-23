# PDF2MD Stripe-Paygate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anonyme Besucher können fünf textbasierte PDFs pro Berliner Kalendertag bis 1 MiB kostenlos konvertieren und für 2 € einen 30-Tage-Pass mit weiteren 50 Konvertierungen/Tag bis 10 MiB kaufen, wiederherstellen und durch erneuten Kauf stapeln.

**Architecture:** Der gleichursprüngliche Node-Server übernimmt Identität, Quotenentscheidung, Checkout und signierte Stripe-Webhooks; die Python-API bleibt der auf 10 MiB/100 Seiten begrenzte reine Konverter. PostgreSQL-`paygate` ist die alleinige Quelle für Limits, Verbrauch und Entitlements; der Browser sieht weder DB-Zugang noch Stripe-Secret. Erst nach validierter Dateigröße und erfolgreicher Quotenreservierung wird an die API gesendet; fehlgeschlagene Konvertierungen geben die reservierte Einheit zurück.

**Tech Stack:** Node.js/CommonJS, `pg`, `stripe`, `busboy`, React 19/CRA, FastAPI/PyMuPDF unverändert, PostgreSQL 17; Node-Test-Runner, Jest/Testing Library.

**Spec:** `.hermes/handoffs/2026-11-22-paygate-db-handoff.md` (DB-Handoff mit exakten SQL-Funktionen und Seeds). Dieses Dokument plant die *App-Integration*, nicht eine konkurrierende Implementierung des dort eigenständig beauftragten DB-Jobs.

## Current context / assumptions

- Repo-Root `/root/repo/pdf_to_markdown`; App unter `pdf_to_markdown/`, Python unter `API/`. `pdf_to_markdown/server.cjs` streamt bisher unlimitiert im Sinne der Quoten direkt zur API, mit Gesamtkörperlimit 10 MiB + 64 KiB; `API/app.py` prüft 10 MiB/100 Seiten. `src/App.js` hat einen deaktivierten Donate-Button und akzeptiert clientseitig 10 MiB. Tests: `server.test.cjs`, `src/App.test.js`, `API/tests/test_api.py`.
- Öffentliche Cloudflare-Pages-Seite ist derzeit nur statisch; `/v1/convert` ist dort nicht erreichbar. Kein bezahltes Angebot bewerben, bevor dieselbe öffentliche Origin Node-Endpunkte tatsächlich per HTTPS erreicht.
- Handoff-DB war bei der ersten Bestandsaufnahme noch nicht provisioniert (`/opt/paygate` fehlte); Port 5433 war bereits durch `supabase-empatify-pooler` auf 0.0.0.0 belegt. Vor Ausführung Zustand erneut prüfen; der DB-Handoff wählt den nächsten freien *loopback*-Port. `/opt/paygate/.env` enthält auch das Postgres-Superuser-Passwort: die Node-App darf diese Datei niemals sourcen oder lesen. Nur die App-Rollen-URL in eine separate serviceeigene Secret-Datei übernehmen.
- Scope: Einzeldatei-Upload, einmaliger Stripe-Checkout `mode: payment`; **keine** Subscription, Batch-Verarbeitung oder OCR. „Mehr Konvertierungen“ bedeutet mehr Tageskontingent, nicht Mehrfach-Upload.
- Produktentscheidung von Marco: **Variante 2**. Ein Wiederherstellungscode schaltet ausschließlich den Pass seines eigenen Kaufs frei; auf einem neuen Gerät müssen für mehrere Käufe die jeweiligen Codes einzeln eingelöst werden. Dies ersetzt für `pdf2md` bewusst die kundenweite Wiederherstellung aus dem DB-Handoff; die dortige Basisfunktion bleibt für andere Apps unverändert.

## Global constraints

- App-ID `pdf2md`, SKU `pass50`, 5/Tag bis 1048576 Bytes und IP-Kappung 15/Tag; bezahlter Pass 200 EUR-Cent, 50/Tag bis 10485760 Bytes, 30 Tage; Zeitzone `Europe/Berlin` (aus Handoff-Seed).
- Keine Konten. Browser-ID: 128 zufällige Bits als signiertes HttpOnly/Secure/SameSite=Lax-Cookie; DB sieht ausschließlich SHA-256 des unverfälschten Wertes. IP: HMAC-SHA256 mit separatem serverseitigem Secret über `client_ip + '|' + yyyy-mm-dd` nach Berliner Datum; keine Klartext-IP in DB.
- Nur verifizierte `checkout.session.completed`/`checkout.session.async_payment_succeeded` mit `payment_status=paid` erfüllen; vollständige `charge.refunded` und `charge.dispute.created` widerrufen. Webhook benötigt Rohbytes für Signatur. Der pdf2md-Dienst verwendet eine eigens beschränkte DB-Rolle und ausschließlich die nachgelagerten, gegen Reversals gesicherten Funktionen (Task 5), nicht direkt die breiten Handoff-Funktionen.
- Nicht in Webhook-/Server-/Access-Logs: PDFs, Markdown, E-Mails, Restore-Codes, Secrets oder Session-IDs; verschlüsselte private Secretablage außerhalb von Git, keine `REACT_APP_`-Secrets. `API_TOKEN` bleibt serverseitig.
- Keine App-Änderung an `/opt/paygate/sql/001_schema.sql`; Schema und Seed gehören zum separaten DB-Handoff. Falls die Funktionen andere Signaturen haben: STOP, nicht stillschweigend umdeuten.
- TDD in **jeder** Code-Task: Test schreiben → gezielten RED mit erwarteter Assertion/fehlendem Export sehen → minimal implementieren → gezielten GREEN und vorhandene Tests → Commit. Nie Tests als „grün“ behaupten, solange reale DB/Stripe-Konfiguration fehlt.

## Review focus (mit Tests in den zugehörigen Tasks)

1. Gefälschter `X-Forwarded-For`/`CF-Connecting-IP` darf Tages-IP-Limit nicht umgehen (Task 2).
2. Multipart-Overhead zählt nicht als PDF-Dateigröße; 1 MiB PDF ist frei, 1 MiB + 1 Byte braucht einen Pass (Task 3).
3. Ein verifizierter, aber unbezahlt/asynchroner Checkout oder falscher Betrag darf keinen Pass ausstellen (Task 5).
4. Webhook-Replay und Refund vor Fulfillment dürfen keinen gültigen Pass hinterlassen (Task 5).
5. DB-/Stripe-Ausfall und API-Fehler dürfen weder eine kostenfreie Umgehung noch eine behauptete, aber tatsächlich fehlgeschlagene Gutschrift verursachen; *genau-einmal* bei Prozessabsturz ist ohne Reservation-ID nicht garantiert (Tasks 3–5).

## Step-by-step tasks

### Task 0: Datenbank-Handoff als separate Voraussetzung abnehmen

**Files:** Read-only `.hermes/handoffs/2026-11-22-paygate-db-handoff.md`; kein App-Code. DB-Agent führt ausschließlich dessen Tasks 1–6 aus (Postgres-Container, Schema, Rolle, Seed, Rauchtest, Wartung). Keine laufenden Services stoppen. **Vor** jeder Produktivschaltung nachweisen:

- [ ] `docker inspect -f '{{.State.Health.Status}}' paygate-db` → `healthy`; `ss -ltnp` → gewählter Port ausschließlich `127.0.0.1`; 5433 nicht verwenden.
- [ ] `docker exec paygate-db psql -U postgres -d paygate -v ON_ERROR_STOP=1 -Atc "select free_units_per_day,free_units_per_day_ip,free_limits->>'max_file_bytes' from paygate.apps where id='pdf2md';select sku,amount_cents,units,quota_period,valid_days,limits->>'max_file_bytes' from paygate.products where app_id='pdf2md';"` → `5|15|1048576` und `pass50|200|50|day|30|10485760`.
- [ ] Handoff-Rauchtest → `NOTICE: PAYGATE SMOKE TEST PASSED`; Datenbankpasswort-Datei `/opt/paygate/.env` bleibt mode 600; Backup-Test und Restore-Probe laut Handoff. Kein Commit für diesen unabhängig beauftragten Ops-Job.
- [ ] Für **jede** Umgebung separat Stripe Price und Product mit dem *Checkout-Secret-Key desselben Accounts/Modus* lesend prüfen: `active=true`, `livemode` passend, `currency='eur'`, `unit_amount=200`, `type='one_time'`, `recurring=null`, Product aktiv und für SKU `pass50`; `price_...` kodiert keinen Modus. Nach Freigabe setzt ein DB-Operator (nicht `paygate_app`) genau den Seed-Eintrag, ohne abweichende Zuordnung zu überschreiben. Aus Repo-Root mit geprüfter ID statt Platzhalter:

```bash
PRICE_ID='price_REPLACE_WITH_VERIFIED_ID'
test "$PRICE_ID" != 'price_REPLACE_WITH_VERIFIED_ID' || exit 1
docker exec -i paygate-db psql -X -U postgres -d paygate \
  -v ON_ERROR_STOP=1 -v price_id="$PRICE_ID" <<'SQL'
BEGIN;
SET LOCAL ROLE paygate_owner;
SELECT set_config('paygate.operator_price_id', :'price_id', true);
DO $$
DECLARE n integer;
BEGIN
  IF current_setting('paygate.operator_price_id') !~ '^price_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'invalid Stripe Price ID';
  END IF;
  UPDATE paygate.products SET stripe_price_id = current_setting('paygate.operator_price_id')
   WHERE app_id='pdf2md' AND sku='pass50' AND active AND amount_cents=200
     AND currency='eur' AND units=50 AND quota_period='day' AND valid_days=30
     AND limits->>'max_file_bytes'='10485760'
     AND (stripe_price_id IS NULL OR stripe_price_id=current_setting('paygate.operator_price_id'));
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected one matching product and no conflicting mapping'; END IF;
END $$;
COMMIT;
SELECT app_id,sku,stripe_price_id,amount_cents,currency
  FROM paygate.products WHERE app_id='pdf2md' AND sku='pass50';
SQL
```

Expected final row: `pdf2md | pass50 | <verified price_...> | 200 | eur`; on any mismatch `ON_ERROR_STOP` aborts and transaction rolls back. Never use a live Price in test mode or print a Stripe secret.

### Task 1: Paygate-DB-Client und Konfiguration

**Files:** Modify `pdf_to_markdown/package.json`, `pdf_to_markdown/package-lock.json`, `pdf_to_markdown/server.cjs`; create `pdf_to_markdown/paygate.cjs`, `pdf_to_markdown/paygate.test.cjs`; modify `pdf_to_markdown/README.md`.

**Interfaces:** `createPaygate({databaseUrl,ipSecret})` returns `{quota(subjectHash,clientIp), reserveFree(subjectHash,clientIp), reservePaid(subjectHash), refundFreeDay(subjectHash,ipHash,day), refundPaidDay(entitlementId,day), checkoutFulfilled(ref,subjectHash), fulfillGuarded(args), recordReversal(paymentIntentId,status), redeemEntitlement(codeHash,subjectHash), recordAnomaly(eventHash,reason), close()}`; quota and reserve each select DB Berlin day and call SQL function on the *same* `pg` connection/transaction so midnight cannot split hash/day (Task 3). `reserve*` returns the DB-selected day and consumed unit/entitlement. SQL strictly parameterized, `app='pdf2md'`, `pg.Pool({connectionString:databaseUrl,max:5})`. `createServer({token,apiUrl,buildDir,paygate,stripe,publicBaseUrl,ipSecret,codeSecret,cookieSecret,trustedProxyIp})` accepts injected adapters for tests; entrypoint refuses missing secrets/config before listen. Production DB URL MUST authenticate as dedicated `paygate_pdf2md` (Task 5), not `paygate_app`/`postgres`.

- [ ] Write `paygate.test.cjs`: fake pool records `{text,values}`; assert `quota(subjectHash,clientIp)` first queries DB Berlin day, hashes `clientIp+'|'+day`, then calls `select paygate.quota($1,$2,$3)` with `['pdf2md', subjectHash, ipHash]`; `reservePaid` returns the DB day and entitlement or `null`; malicious hash appears *only* in values. Assert startup refuses empty DB URL, IP/code/cookie secrets, weak/identical secrets, Stripe secrets, price ID, invalid HTTPS base URL (HTTP localhost only in tests), wrong DB `current_user`, and DB connection failure. Use distinct `'a'.repeat(64)` / `'b'.repeat(64)` hashes.
- [ ] `(cd /root/repo/pdf_to_markdown/pdf_to_markdown && node --test paygate.test.cjs)` → RED: `Cannot find module './paygate.cjs'` or missing-adapter assertion (not an environment/import typo).
- [ ] `(cd /root/repo/pdf_to_markdown/pdf_to_markdown && npm install pg stripe busboy --save)` and implement `paygate.cjs`. Consult Handoff functions, not direct table writes. Boot-time `SELECT` verifies app/product active, price ID, 200 cents, `eur`, `day`, 50 units and 10 MiB; refuse on mismatch or `current_user <> 'paygate_pdf2md'`. `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `PAYGATE_DATABASE_URL`, `PAYGATE_IP_SECRET`, `PAYGATE_CODE_SECRET`, `PAYGATE_COOKIE_SECRET` (each secret independently generated, >=32 random bytes), `PUBLIC_BASE_URL`, `TRUSTED_PROXY_IP` are server-only config; reject same IP/code/cookie secret. App service account reads only its own mode-600 secret file in a mode-700 directory, not `/opt/paygate/.env`, which includes `POSTGRES_PASSWORD`. Do not print or commit credentials.
- [ ] `(cd /root/repo/pdf_to_markdown/pdf_to_markdown && node --test paygate.test.cjs && npm run test:proxy)` → all pass. Commit from repo root: `git -C /root/repo/pdf_to_markdown add pdf_to_markdown/package.json pdf_to_markdown/package-lock.json pdf_to_markdown/paygate.cjs pdf_to_markdown/paygate.test.cjs pdf_to_markdown/server.cjs pdf_to_markdown/README.md && git -C /root/repo/pdf_to_markdown commit -m 'feat: add paygate client and fail-closed config'`.

### Task 2: Anonyme Identität und nur vertrauenswürdige IP

**Files:** Create `pdf_to_markdown/identity.cjs`, `pdf_to_markdown/identity.test.cjs`; modify `pdf_to_markdown/server.cjs`.

**Interfaces:** `identityFor(req,res,{cookieSecret,trustedProxyIp}) -> {subjectHash,clientIp}`. Cookie `pdf2md_id=<base64url 16 random bytes>.<hex HMAC>`; constant-time signature check, rotate on tampering; `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`, `Cache-Control: no-store`. The DB transaction chooses Berlin day; `paygate.cjs` derives `ipHash=hex(HMAC_SHA256(PAYGATE_IP_SECRET,clientIp+'|'+dbDay))` (Task 3). The socket address is authoritative unless equal to the pinned trusted proxy IP; only then require `req.headersDistinct['cf-connecting-ip']` of **length 1**, no comma list, valid `net.isIP`; otherwise 503 before quota. Normalize and test IPv4/IPv4-mapped representations explicitly. Untrusted peers' forwarding headers are ignored. The ingress must overwrite the header and isolate Node from direct public access.

- [ ] Write `identity.test.cjs`: stable hash on valid cookie, tamper rotates, distinct IDs, cookie flags, no raw cookie in hash, spoofed header ignored for untrusted peer, missing/duplicate/comma-list/invalid trusted-peer headers rejected 503. For user POSTs `/v1/convert`, `/v1/checkout`, `/v1/redeem`, assert missing/`null`/malformed/duplicate/cross-origin `Origin` -> 403 **before** cookie issuance, parsing, quota, Stripe or upstream; exactly one valid Origin matching configured `PUBLIC_BASE_URL` reaches handler. Stripe webhook is exempt, but requires Stripe signature. Explicit test-only CRA origin override may be configured; no production fallback.
- [ ] `(cd /root/repo/pdf_to_markdown/pdf_to_markdown && node --test identity.test.cjs)` → RED: missing `identity.cjs`.
- [ ] Implement identity for `/v1/quota`, `/v1/convert`, `/v1/checkout`, `/v1/redeem`, `/v1/checkout-status`, but first enforce exact Origin on user POSTs using `req.headersDistinct.origin` and `new URL(origin).origin === new URL(publicBaseUrl).origin`; never derive allowed origin from Host/forwarded headers. Do not issue cookie/check Origin for signed Stripe webhook. If real ingress/proxy IP is unknown, postpone deployment rather than guess.
- [ ] `(cd /root/repo/pdf_to_markdown/pdf_to_markdown && node --test identity.test.cjs && npm run test:proxy)` → all pass. Commit: `git -C /root/repo/pdf_to_markdown add pdf_to_markdown/identity.cjs pdf_to_markdown/identity.test.cjs pdf_to_markdown/server.cjs && git -C /root/repo/pdf_to_markdown commit -m 'feat: identify anonymous browser and trusted client IP'`.

### Task 3: Quoten- und Dateigrößenprüfung vor API-Aufruf

**Files:** Modify `pdf_to_markdown/server.cjs`, `pdf_to_markdown/server.test.cjs`; optionally create `pdf_to_markdown/upload.cjs` only if parser separation keeps the proxy focused. Do not change `API/app.py`/`API/compose.yaml`.

**Interfaces:** `GET /v1/quota` -> JSON `{free:{units_left,limits},paid:[{units_left,limits,expires_at,...}]}` with `Cache-Control:no-store`; `POST /v1/convert` -> 200 markdown, 400 malformed PDF/multipart, 402 no matching quota (`{error:'payment_required'}`), 413 >10 MiB, 422 API rejection, 429 admission exhausted, 503 DB failure. `paygate.quota(subjectHash,clientIp)` obtains Berlin day **from DB** and calls `paygate.quota` in that same transaction to derive day-bound IP hash; `reserveFree(subjectHash,clientIp)` performs DB-day SELECT and `consume_free` on the *same connection and transaction* (Postgres `now()` is fixed within a transaction), returning `{day,subjectHash,ipHash}` or null; `reservePaid(subjectHash)` analogously returns `{day,entitlementId}` or null. Commit reservation before API call; refund with stored day/hash/entitlement via Task 5 migration. Recompute limits server-side; size eligibility uses actual multipart file bytes, not Content-Length. <=1 MiB tries free then paid; >1 MiB paid only; >10 MiB denied before any quota consume. All active paid pdf2md products must have `quota_period='day'` and the same 10 MiB limit (base `consume_paid` is size-unaware); boot fails otherwise. API still validates PDF signature/page count.

- [ ] Extend `server.test.cjs` with fake paygate/identity/upstream: exactly 1048576 file bytes uses free despite multipart overhead; 1048577 bytes paid; exhausted free with paid uses paid; no credits 402 and no upstream; >10 MiB 413 without consume; forged Content-Length cannot bypass; malformed/second-file multipart rejects without consume; API 400/422, definitive upstream failure before 200 refund once; upstream 200 followed by client abort/truncated downstream refunds **zero**; uncertain outcome after send records redacted reconciliation instead of automatic refund; DB outage 503; quota GET shows 2 x 50 -> 100. Assert outbound multipart has **one** field `file`, fixed filename `document.pdf`, MIME `application/pdf`, correct boundary/Content-Length, byte-identical PDF and server-only bearer token; attacker filename/MIME/extra fields never reach API. Hold eight uploads open: ninth 429/`Retry-After: 1`, no parser/consume/upstream; after one releases new upload is accepted. Assert slot release on every terminal error/success. Mock DB transaction crossing Berlin midnight and DST; reservation/refund carry the same DB-selected day and IP hash. Use `finally` cleanup.
- [ ] `(cd /root/repo/pdf_to_markdown/pdf_to_markdown && npm run test:proxy)` → RED on 1 MiB+1/402/quota assertions (existing tests still pass).
- [ ] Before body parsing admit at most **8 concurrent** `/v1/convert` requests per Node process; excess immediately 429 with `Retry-After: 1`, `Connection: close`, without body/DB/API work. Hold slot through parsing, upstream and refund settlement; release exactly once on all exits. `busboy` limits `files:1,fileSize:10485760,fields:0,parts:1` plus 10 MiB+64 KiB total request cap; buffer at most one PDF (max 80 MiB across 8 uploads plus socket overhead). Reject parser limits before consume. After reserve, generate a server-owned boundary and one new multipart part with `Content-Disposition: form-data; name="file"; filename="document.pdf"` and `Content-Type: application/pdf`; preserve PDF bytes exactly and close with CRLF boundary; set matching top-level `Content-Type` and calculated `Content-Length`. Do not forward browser filename, headers or extra fields; do not duplicate the full PDF buffer. On definitive non-200 or failure *before* upstream 200, call saved-day `refundFreeDay`/`refundPaidDay` at most once. Receipt of upstream 200 headers commits the unit: browser disconnect/partial response never refunds. If abort after send leaves upstream outcome unknown, record redacted reconciliation, not speculative refund. Failed refund also requires reconciliation; no assertion of exactly-once across process crashes. Preserve fixed download headers/error redaction. For midnight-safe refunds use reviewed SQL migration in Task 5.
- [ ] `(cd /root/repo/pdf_to_markdown/pdf_to_markdown && npm run test:proxy && CI=true npm test -- --watch=false --runInBand && npm run build) && (cd /root/repo/pdf_to_markdown/API && .venv/bin/python -m pytest -q)` → all pass (create venv/install requirements-dev.txt during execution if missing). Commit from root: `git -C /root/repo/pdf_to_markdown add pdf_to_markdown/server.cjs pdf_to_markdown/server.test.cjs && git -C /root/repo/pdf_to_markdown commit -m 'feat: enforce quota before conversion'` (if `upload.cjs` created, add it explicitly before commit).

### Task 4: Stripe Checkout und Restore-Code

**Files:** Create `pdf_to_markdown/payments.cjs`, `pdf_to_markdown/payments.test.cjs`; modify `pdf_to_markdown/server.cjs`.

**Interfaces:** `POST /v1/checkout` returns `{url}` from server-created Stripe `checkout.sessions.create({mode:'payment',line_items:[{price:stripePriceId,quantity:1}],success_url:publicBaseUrl+'/?session_id={CHECKOUT_SESSION_ID}',cancel_url:publicBaseUrl+'/',client_reference_id:subjectHash,metadata:{app:'pdf2md',sku:'pass50',subject_hash:subjectHash},payment_intent_data:{metadata:{app:'pdf2md',sku:'pass50'}}})`; no client amount/price/sku accepted. `GET /v1/checkout-status?session_id=...` retrieves Session server-side, checks app/SKU/paid and **DB buyer-binding for that exact ref** before `{status:'ready',restore_code}`; otherwise `{status:'pending'}`. No email/arbitrary Stripe JSON in response. `restoreCode = createHmac('sha256',PAYGATE_CODE_SECRET).update('pdf2md|'+session.id,'utf8').digest('base64url')` (256 bits); `codeHash = createHash('sha256').update(restoreCode,'utf8').digest('hex')` matches `/^[0-9a-f]{64}$/`; **only codeHash** goes to DB. URL uses `Referrer-Policy:no-referrer`, never log query strings. `POST /v1/redeem` accepts `{code}` length <=128, hashes identically, calls `redeemEntitlement(codeHash,subjectHash)` with five-device cap; returns `{passes:0|1}`, no distinction invalid/capped. **Beschlossene Variante 2:** Ein Code schaltet nur den Pass seines Kaufs frei, nicht andere Pässe mit gleicher Checkout-E-Mail. Bei mehreren Käufen muss man auf einem neuen Gerät jeden Code einzeln einlösen. Rate-limit restore and checkout by subject+IP (in-process while single Node process; shared limiter required before horizontal scaling).

- [ ] Write `payments.test.cjs` with fake Stripe/paygate: exact Checkout fixed price and client reference; no raw cookie/IP/code in metadata; stable code on repeated paid, exact buyer-bound status lookup, pending/unpaid/mismatched never exposes code; `fulfillGuarded` receives `codeHash === sha256hex(restoreCode)` (not raw code); another device redeems only matching entitlement, same-email other purchase remains inaccessible; invalid/oversized code 400, burst 429, transient Stripe failure 503 redacted.
- [ ] `(cd /root/repo/pdf_to_markdown/pdf_to_markdown && node --test payments.test.cjs)` → RED missing module.
- [ ] Implement payment adapter and routes. SQL `redeem_code` binds *all* active passes of the same customer; zero means invalid/capped. Do **not** grant app direct SELECT on `entitlements/customers` or return code based on some unrelated pass. Create reviewed follow-on migration `pdf_to_markdown/sql/020_checkout_status.sql` exactly as follows; it runs after the independent DB handoff (never change its base SQL):

```sql
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
```

`payments.cjs` calls `select paygate.checkout_fulfilled($1,$2)` only after retrieving a paid matching Stripe Session. Create `pdf_to_markdown/sql/920_checkout_status_test.sql` exactly as follows; execute it in a disposable DB only (it deliberately rolls back):

```sql
begin;
do $$
declare
  v_subject text := repeat('a',64);
  v_other text := repeat('b',64);
  v_ent uuid;
begin
  assert not paygate.checkout_fulfilled('cs_test_checkout_status',v_subject), 'unknown';
  v_ent := paygate.fulfill_purchase('pdf2md','pass50','test-only@example.invalid',
    'cs_test_checkout_status','pi_test_checkout_status',200,'eur',repeat('c',64),v_subject);
  assert v_ent is not null, 'fulfill';
  assert paygate.checkout_fulfilled('cs_test_checkout_status',v_subject), 'buyer';
  assert not paygate.checkout_fulfilled('cs_test_checkout_status',v_other), 'other subject';
  assert paygate.refund_purchase('pi_test_checkout_status'), 'refund';
  assert not paygate.checkout_fulfilled('cs_test_checkout_status',v_subject), 'revoked';
  raise notice 'CHECKOUT STATUS TEST PASSED';
end $$;
rollback;
```

Apply migration with `docker exec -i paygate-db psql -U postgres -d paygate -v ON_ERROR_STOP=1 < pdf_to_markdown/sql/020_checkout_status.sql` from repo root after DB operator review. Smoke test analogously using `920_checkout_status_test.sql`; expected notice and rollback, with no retained synthetic purchase. In Task 5 only the dedicated role gains permission. If the separate DB changes are not approved, defer checkout-status/code UI and production release.
- [ ] `(cd /root/repo/pdf_to_markdown/pdf_to_markdown && node --test payments.test.cjs && npm run test:proxy)` → all pass; disposable-DB SQL smoke → `CHECKOUT STATUS TEST PASSED`, no retained synthetic purchase. Commit: `git -C /root/repo/pdf_to_markdown add pdf_to_markdown/payments.cjs pdf_to_markdown/payments.test.cjs pdf_to_markdown/server.cjs pdf_to_markdown/sql/020_checkout_status.sql pdf_to_markdown/sql/920_checkout_status_test.sql && git -C /root/repo/pdf_to_markdown commit -m 'feat: create fixed-price checkout and code redemption'`.

### Task 5: Signaturgeprüfter Webhook und Reversal

**Files:** Modify `pdf_to_markdown/payments.cjs`, `pdf_to_markdown/payments.test.cjs`, `pdf_to_markdown/paygate.cjs`, `pdf_to_markdown/server.cjs`; create `pdf_to_markdown/sql/025_pdf2md_guards.sql`, `pdf_to_markdown/sql/925_pdf2md_guards_test.sql` (SQL applied by DB operator **after** base handoff and `020_checkout_status.sql`).

**Interfaces:** `POST /v1/stripe/webhook` reads raw body (max 256 KiB), `stripe.webhooks.constructEvent(raw,signature,webhookSecret)` before any DB/provider side effect. Signed checkout event's `data.object.id` is only a lookup key: `stripe.checkout.sessions.retrieve(id,{expand:['payment_intent.latest_charge']})` and `stripe.checkout.sessions.listLineItems(id,{limit:2})`; require one item, `has_more===false`, `quantity===1`, `price.id===STRIPE_PRICE_ID`. Require `mode='payment'`, `status='complete'`, `payment_status='paid'`, `amount_total===200`, `currency==='eur'`, metadata app/SKU/64-hex subject, `client_reference_id===metadata.subject_hash`, valid `customer_details.email` (never substitute `customer_email`), expanded succeeded PaymentIntent with matching amount/currency and expanded succeeded latest Charge, same `payment_intent` ID. For full refund/dispute, retrieve current Charge/PI and confirm `charge.refunded===true` or full `amount_refunded` / `disputed===true`; partial refund does not revoke. PaymentIntent metadata app/SKU (set on checkout via `payment_intent_data`) scopes refund-first tombstones; reject unrelated PI. Use **only** guarded SQL wrappers below, with `codeHash=sha256hex(base64url(HMAC_SHA256(codeSecret,'pdf2md|'+session.id)))`; never pass plaintext code to DB. Query Stripe before fulfillment and again after; the DB guard closes the concurrent race. Response matrix: bad/missing signature 400; oversize 413; verified unpaid/unhandled 200 with no action; permanent signed mismatch/missing email 200 **only after** `recordAnomaly(sha256hex(event.id),reason)` persists a coded alert; Stripe timeout/429/5xx, DB outage (including failed alert write) or uncertain commit 500/503 for retry; confirmed fulfillment/reversal/duplicate 200. Do not claim successful handling on an in-memory-only deferred task. Redact IDs, email and document content from logs/alerts.

- [ ] Write SQL RED test `sql/925_pdf2md_guards_test.sql` as a single `BEGIN; ... ROLLBACK;`: synthetic same-email purchases A/B with different hashes and subjects; A's code binds only A (B inaccessible), repeated redeem 1, bad/expired/revoked/capped codes 0; reversal *before* fulfillment creates tombstone and later guarded fulfill returns NULL; fulfillment then reversal ends revoked; parallel sessions against same PI cannot leave a live pass after both commit; disputed status wins over refunded; free and paid refund across Berlin midnight only decrements saved day D, not D+1; app role executes only wrappers/quota/consume/status, cannot execute base `fulfill_purchase`, `refund_purchase`, `redeem_code` or select customers/purchases/reversals. End with `RAISE NOTICE 'PDF2MD GUARDS TEST PASSED'`; do not use real data. Write Node signed-event tests: mismatched/paid/unpaid, missing email despite `customer_email`, string instead of expanded PI/Charge, two line-item pages, partial/full refund/dispute, reversal before/around fulfill, stable codeHash equal to SHA-256 of returned restoreCode, all response-matrix statuses; test a fake Stripe state flip between pre/post checks.
- [ ] On disposable Handoff DB, run `docker exec -i paygate-db psql -U postgres -d paygate -v ON_ERROR_STOP=1 < pdf_to_markdown/sql/925_pdf2md_guards_test.sql` from repo root **before** migration → RED `function paygate.pdf2md_fulfill_guarded(...) does not exist` (or equivalent missing wrapper), never a test-setup error. `(cd /root/repo/pdf_to_markdown/pdf_to_markdown && node --test payments.test.cjs)` → RED on webhook/reversal assertions.
- [ ] Create `sql/025_pdf2md_guards.sql`: in one `BEGIN`/`COMMIT`, operator creates `paygate_pdf2md LOGIN`, grants DB CONNECT, schema USAGE, SELECT on only apps/products; `SET LOCAL ROLE paygate_owner` for objects below. Set separate role password **out of band** without Git/history. Define `paygate.pdf2md_reversals(payment_intent_id text PRIMARY KEY,status text CHECK(status IN ('refunded','disputed')),recorded_at timestamptz DEFAULT now())` and `paygate.pdf2md_webhook_anomalies(event_hash paygate.hash64 PRIMARY KEY,reason text NOT NULL CHECK(reason IN ('price_mismatch','metadata_mismatch','missing_email','invalid_provider_shape')),recorded_at timestamptz DEFAULT now())`. Define SECURITY DEFINER functions with `SET search_path=pg_catalog,pg_temp`, fully qualified tables, parameter validation and explicit `REVOKE EXECUTE FROM PUBLIC`:
  - `paygate.pdf2md_fulfill_guarded(p_email text,p_stripe_ref text,p_payment_intent_id text,p_code_hash text,p_subject_hash text,p_stripe_customer_id text) RETURNS uuid`: require nonempty refs and 64-lowercase-hex hashes; take `pg_advisory_xact_lock(hashtextextended('pdf2md|'||p_payment_intent_id,0))`; if reversal tombstone exists return NULL; else call `paygate.fulfill_purchase('pdf2md','pass50',p_email,p_stripe_ref,p_payment_intent_id,200,'eur',p_code_hash,p_subject_hash,p_stripe_customer_id)` exactly once. This wrapper *does not replace* Node's verified Price/amount check.
  - `paygate.pdf2md_record_reversal(p_payment_intent_id text,p_status text) RETURNS boolean`: require nonempty PI and status refunded/disputed, take **same** advisory lock, UPSERT tombstone even without purchase; preserve `disputed` precedence; use resulting status in `paygate.refund_purchase(p_payment_intent_id,effective_status)`; return true even if purchase did not yet exist. On a later checkout event, guarded fulfillment returns NULL. Both functions serialize for the same PI; provider pre/post checks cover delayed webhook delivery, not the SQL race itself.
  - `paygate.redeem_pdf2md_entitlement(p_code_hash text,p_subject_hash text,p_max_subjects int) RETURNS int`: find **only** matching pdf2md entitlement joined to paid purchase, unrevoked/unexpired; lock `FOR UPDATE OF e`; return 1 if subject already bound, else insert only when count < cap; otherwise 0. Never call handoff `redeem_code`, whose same-email customer-wide behavior is vulnerable to an unverified Checkout email. Marco hat diese Abweichung als Variante 2 entschieden; die Migration benötigt weiterhin DB-Operator-Freigabe.
  - `paygate.refund_pdf2md_free_day(p_subject_hash text,p_ip_hash text,p_day date) RETURNS int`: decrement positive `free_usage` rows of `pdf2md` for supplied day and matching subject/IP, return row count (normally 2). `paygate.refund_pdf2md_paid_day(p_entitlement_id uuid,p_day date) RETURNS int`: decrement positive `entitlement_usage` in supplied day only for `pdf2md` daily entitlement, return row count (normally 1). Both are **not** idempotent across repeated calls; call at most once per request and reconcile anomalies.
  - `paygate.pdf2md_record_anomaly(p_event_hash text,p_reason text) RETURNS void`: require lowercase 64-hex hash and one of the four codes above, UPSERT into `pdf2md_webhook_anomalies` on event hash; never store raw event ID, email, session, code or Stripe payload. Alert operator via restricted operational view of this table (or equivalent monitored count); a failed write is retryable 5xx, never a false 200.
  - Grant dedicated `paygate_pdf2md` role SELECT on config, EXECUTE only on `quota(text,text,text)`, `consume_free(text,text,text)`, `consume_paid(text,text)`, `checkout_fulfilled(text,text)`, and the six new wrappers above; *no* EXECUTE on base `fulfill_purchase`, `refund_purchase`, `redeem_code`, `refund_free` or `refund_paid`, no personal-table SELECT. Explicitly assert privileges in smoke test. Keep base `paygate_app` for other pages; do not hand its URL to pdf2md.
- [ ] Apply SQL with `docker exec -i paygate-db psql -U postgres -d paygate -v ON_ERROR_STOP=1 < pdf_to_markdown/sql/025_pdf2md_guards.sql` on a disposable DB, then same command for `925_pdf2md_guards_test.sql` → `NOTICE: PDF2MD GUARDS TEST PASSED` and `ROLLBACK`; run two concurrent psql sessions for lock-order race as above. Run Node tests → `# fail 0`. If any migration/test fails stop; no production apply. The DB operator separately provisions a `paygate_pdf2md` role URL into app-only secret file; boot asserts `current_user='paygate_pdf2md'`.
- [ ] Implement webhook handler before static/method gate; no Origin/cookie processing on this route. Handle permanent failure with safe 200 + **persistent** alert (do not leak IDs), transient failure with retryable 5xx. Once paid event passes validation, `fulfillGuarded` returns UUID or NULL for preexisting tombstone; recheck latest Charge immediately afterward and `recordReversal` if now refunded/disputed. Duplicate events do not create second pass. For signed charge events re-fetch provider state, match PI metadata app/SKU, record only complete reversal; keep 200 on unrelated/partial. Webhook logs record event type/outcome only. No direct table writes from Node.
- [ ] `(cd /root/repo/pdf_to_markdown/pdf_to_markdown && node --test payments.test.cjs && npm run test:proxy && CI=true npm test -- --watch=false --runInBand)` → all pass. Commit: `git -C /root/repo/pdf_to_markdown add pdf_to_markdown/payments.cjs pdf_to_markdown/payments.test.cjs pdf_to_markdown/paygate.cjs pdf_to_markdown/server.cjs pdf_to_markdown/sql/025_pdf2md_guards.sql pdf_to_markdown/sql/925_pdf2md_guards_test.sql && git -C /root/repo/pdf_to_markdown commit -m 'feat: guard fulfillment, reversal and per-pass recovery'`.

### Task 6: UI, copy and legal/deployment documentation

**Files:** Modify `pdf_to_markdown/src/App.js`, `pdf_to_markdown/src/App.css`, `pdf_to_markdown/src/App.test.js`, `pdf_to_markdown/README.md`, `API/README.md` only if its operational contract actually changed (it should not).

**Interfaces:** On initial load fetch `/v1/quota`; show free balance, summed active paid balance, 1 MiB free/10 MiB paid, offer `2 € / 50 PDFs pro Tag / 30 Tage`, buy button and restore-code form; on 402 offer Checkout instead of generic retry. On successful return `session_id` poll `/v1/checkout-status` boundedly, then show restore code once with explicit warning to save it; scrub `session_id` from URL via `history.replaceState` after status resolves; after restore refresh quota. Client never treats redirect as proof of payment; error/503 conveys retry. Do not replace true backend limits with a hardcoded “free” label. Keep 10 MiB overall client cap and no-OCR/100-page message.

- [ ] Add RTL tests to `src/App.test.js` with fake `fetch` quota + fake XHR upload: free quota and paid sum visible, 402 displays buy CTA, checkout URL navigation (stub `window.location.assign`), pending return cannot show code, ready return shows it and cleans URL, redeem refreshes quota, DB unavailable shows non-deceptive error, exactly-1-MiB selected file still accepted. Update previous disabled-Donate expectation (can remove Donate in favor of pass CTA, or retain Donate disabled separately).
- [ ] `(cd /root/repo/pdf_to_markdown/pdf_to_markdown && CI=true npm test -- --watch=false --runInBand)` → RED on missing quota/CTA.
- [ ] Implement UI and responsive styles. Update privacy draft: signed cookie, HMAC IP-day hash, Stripe email/payment processing, per-purchase restore codes, retention, processors, real operational/logging details; mark legal basis/final copy for legal review without invented certainty. Document exact server-only env names including distinct `PAYGATE_COOKIE_SECRET`, test/live Price & Webhook endpoint, app-owned secret vs root-only superuser file, 5433 collision, trusted proxy/HTTPS, source release, refund/reconciliation and rollback. Do not publish paid claims on static-only Cloudflare Pages.
- [ ] `(cd /root/repo/pdf_to_markdown/pdf_to_markdown && CI=true npm test -- --watch=false --runInBand && npm run test:proxy && npm run build) && (cd /root/repo/pdf_to_markdown/API && .venv/bin/python -m pytest -q)` → all green; build succeeds. Commit: `git -C /root/repo/pdf_to_markdown add pdf_to_markdown/src/App.js pdf_to_markdown/src/App.css pdf_to_markdown/src/App.test.js pdf_to_markdown/README.md && git -C /root/repo/pdf_to_markdown commit -m 'feat: show quota, pass purchase and recovery UI'`.

### Task 7: End-to-end staging, security checks and release gate

**Files:** Modify `pdf_to_markdown/README.md` for runbook only if needed; no live mutation without separate authorization.

- [ ] Provision isolated staging DB from Handoff; apply `020_checkout_status.sql` and `025_pdf2md_guards.sql` with `ON_ERROR_STOP=1`, map verified test-mode Price via Task 0 operator command, run both SQL smoke tests; verify 8 base tables/9 base functions **plus** the follow-on checkout-status function, 2 guard tables and 6 wrapper functions. Use `psql "$PAYGATE_DATABASE_URL" -v ON_ERROR_STOP=1 -c "select current_user,paygate.quota('pdf2md',repeat('a',64),repeat('b',64))"` → role `paygate_pdf2md`, JSON free balance 5 and empty paid; verify role cannot read customers or execute base purchase/refund/redeem. Do not supply broad handoff `paygate_app` URL to Node.
- [ ] Run staging Node+API behind same-origin HTTPS, with test-mode Stripe key/Price/webhook secret from same account/mode; Stripe CLI/Dashboard test delivery: 1 MiB free x5, sixth 402; 200-cent paid checkout, signed webhook grants 50/Tag up to 10 MiB, second stacks to 100; invalid PDF gets same-day refund; after midnight refund only touches original day; another device restores **only the coded pass**, including two purchases sharing an email; duplicate webhook no duplicate purchase; full refund/dispute revokes even before checkout completion, partial refund does not. Verify read-only DB counters/provider test IDs, no secrets/PII in reports. Use synthetic PDFs.
- [ ] `(cd /root/repo/pdf_to_markdown/pdf_to_markdown && npm run test:proxy && CI=true npm test -- --watch=false --runInBand && npm run build) && (cd /root/repo/pdf_to_markdown/API && .venv/bin/python -m pytest -q)` → zero failures. `git -C /root/repo/pdf_to_markdown status --short` → only intentional handoff/plan files, no credentials; `git -C /root/repo/pdf_to_markdown diff --check` → no output.
- [ ] Production cutover requires separate operational approval: **Variante 2 (per-purchase restore) ist von Marco entschieden**; DB operator still approves follow-on migrations/dedicated role. Verify TLS and complete ingress chain (which peer overwrites `CF-Connecting-IP`, Cloudflare source authentication, origin firewall, Node not reachable directly); test duplicate/spoofed header through ingress. Check Node non-root account cannot read `/opt/paygate/.env`, can read only service-owned mode-600 secret file; verify rate/concurrency limits, DNS/same-origin Node routing, API/DB loopback, Stripe live-mode IDs/endpoints, durable webhook anomalies, delivery monitoring, DB backup with off-host copy/restore drill, legal/licensing approval. Without proof, postpone public release. Rollback public checkout/route to last good build but keep DB/webhook reconciliation until pending payments/refunds resolved; do not delete DB/secrets.

## Tests / validation

Each task contains its own RED→GREEN→commit. Full regression commands in Tasks 3/6/7; all tests use synthetic PDFs and fake Stripe except the explicitly designated staging smoke test. Expected targeted runner output: Node TAP `# fail 0`; Jest `Test Suites: ... passed`; pytest `... passed`; CRA `Compiled successfully.` Do not invent exact counts. For an unavailable `.venv`, create it/install `API/requirements-dev.txt` *during execution*, then rerun. SQL smoke tests use `-v ON_ERROR_STOP=1` and rollback; no production write merely to test.

## Risks, tradeoffs, open questions

- **Critical:** Handoff `paygate_app` can call `fulfill_purchase/refund_purchase/redeem_code` without price validation and would permit customer-wide restore from unverified email. Task 5 adds `paygate_pdf2md` with only narrowly scoped wrappers and tombstone lock. Never deploy with the broad role; follow-on migration needs DB-operator approval. Marco's product approval for per-purchase restore is recorded above.
- SQL `consume_paid` is unaware of file size, hence the explicit same-size paid-product boot invariant; introducing tiers later requires a DB function that atomically selects eligible passes, not `quota` preselection followed by `consume_paid`.
- A failed refund RPC after conversion failure leaves a consumed unit; report privately, reconcile. Save the DB-selected Berlin day at reservation and refund its bucket via Task 5 migration, never the new day's usage. Once upstream returns 200, client abort does not refund. Crash between charge and API result or repeated refund cannot be exactly-once without a reservation ID/schema change.
- Original `refund_purchase` returns false if refund arrives first; Task 5's persistent tombstone and transaction advisory lock atomically prevent a later guarded fulfillment. Stripe pre/post checks help delayed delivery but do not by themselves close the race; if delivery never arrives, operational reconciliation is still necessary.
- Code is base64url HMAC of Session ID; DB stores **only** lowercase SHA-256 hex of code. A code is a bearer credential und schaltet gemäß beschlossener Variante 2 **einen** gekauften Pass frei, nicht alle Pässe derselben E-Mail. `checkout-status` verifies Stripe paid plus exact buyer-bound DB fulfillment. Lost code recoverable only via original buyer-bound Session URL; no email-based recovery promised.
- Need deployment/operator decisions before going live: public HTTPS hostname + TLS/proxy and real client-IP source; Stripe account test/live key + fixed Price ID + endpoint signing secret; legal review; off-host backups. No secret or production action is authorized by this plan.

## Claude-review reconciliation (15 findings)

- F1: accepted; persistent PI reversal tombstone + same-key transaction lock and pre/post provider checks, Task 5; no claim that Stripe delivery is instantaneous.
- F2: accepted; fixed one-part multipart field/filename/MIME/boundary and byte-identity test, Task 3.
- F3: accepted as a risk; Handoff intentionally specified customer-wide restore, aber Marco hat **Variante 2 / per-entitlement restore** gewählt. Same-email collision test in Tasks 4–5; DB-operator approval für Migration bleibt erforderlich.
- F4: accepted; exact-Origin guard before identity/body/DB for mutating browser routes, webhook exempt, Task 2.
- F5: accepted; independent `PAYGATE_COOKIE_SECRET`, startup validation, Task 1.
- F6: accepted; same-mode verified Price, guarded one-row operator update, boot check, Task 0/1.
- F7: accepted; retrieve Session with expanded PI/Charge, listLineItems limit 2, `customer_details.email`, strict shape tests, Task 5.
- F8: accepted; 8 concurrent upload slots per process before buffering plus release tests, Task 3.
- F9: accepted; refund only definitive failure before upstream 200, not client abort after success, Task 3.
- F10: accepted; DB-day reservation and saved-bucket refund wrappers instead of current-day functions, Tasks 1/3/5.
- F11: accepted with qualification; permanent signed mismatch 200 **only after durable, redacted anomaly record**; transient provider/DB failure 5xx, Task 5.
- F12: accepted; non-root app-specific secret file/role URL, no app access to root-only Postgres env, Tasks 1/7.
- F13: accepted; `headersDistinct`, trusted peer, verified header overwrite, ingress test and cutover gate, Tasks 2/7.
- F14: accepted; absolute test subshells and `git -C /root/repo/pdf_to_markdown` for commits, Tasks 1–7.
- F15: accepted; SHA-256 hex of base64url HMAC code, exact comparison test, Tasks 4–5.

These are **plan changes only**: no SQL migration, code, tests, Stripe object or live service was executed or changed. Per-purchase restore is now an explicit product decision; follow-on DB migrations and production ingress topology remain operational release gates, not assumed approvals.
