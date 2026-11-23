# Task 4 — TDD report

## Scope and outcome

Base: `9f6fc5a3f3887f59db08db6f58fe33b5bdfb700a` on `main`. Implemented server-owned, fixed-price Stripe Checkout; authenticated buyer-bound status polling with exact-session Stripe checks and narrow `paygate.checkout_fulfilled(ref,subjectHash)` lookup; deterministic HMAC restore code and SHA-256 code hash; and per-purchase redeem through the existing `redeemEntitlement(codeHash,subjectHash)` adapter (which supplies five-device cap to the Task 5 SQL wrapper). JSON routes reject unrecognized checkout fields and invalid codes, retain Origin/identity guards and no-referrer/no-store headers, redact dependency failures, and rate-limit checkout/status/redeem independently by both subject and IP in a single process. No email, cookie, IP, or code goes to Stripe metadata or the payment DB. No raw request URL is logged.

Added `pdf_to_markdown/sql/020_checkout_status.sql` and `920_checkout_status_test.sql` byte-for-byte as fenced in the brief; verified both by programmatic comparison. Migration and rollback smoke SQL were **not executed**: the independent DB handoff/approval and disposable database are absent. No DB/service provisioning or external Stripe request occurred.

## RED → GREEN

1. Wrote `payments.test.cjs` against fake Stripe and paygate. `node --test payments.test.cjs` failed with `Cannot find module './payments.cjs'` (exit 1, one failed test file). Only then created the adapter and wired routes.
2. First implementation run: six tests passed and the HTTP status test failed because the fake Stripe session still held the fixed unit-test subject rather than checkout's generated cookie subject. Corrected the fake to return the subject metadata actually submitted at creation; reran to green. This was a fixture modeling error, not a production auth bypass.
3. Added a second-purchase ownership isolation fake: redeeming one code modifies only that purchase's simulated entitlement; the other code is separately required. Task 5 must enforce this in its real SQL wrapper.

## Verification (fresh final run)

- `node --test payments.test.cjs`: **8/8 pass**.
- `npm run test:proxy`: **21/21 pass**.
- `node --test *.test.cjs`: **51/51 pass**.
- `CI=true npm test -- --watch=false --runInBand`: **4/4 Jest pass**.
- `npm run build`: compiled successfully.
- `git diff --check`: clean.
- SQL text exactness: both files matched the brief.

## Boundaries and blockers

- **No SQL smoke** (`CHECKOUT STATUS TEST PASSED` not observed); SQL intentionally not applied pending operator review/independent DB handoff. No claim of working production DB permissions or end-to-end paid checkout.
- No webhook fulfillment is implemented in Task 4. `fulfillGuarded(codeHash)` assertion cannot honestly be demonstrated in a verified webhook flow here. Task 5 must verify Stripe signatures before fulfillment and pass `sha256hex(HMAC restoreCode)` into `fulfillGuarded`; polling never fulfills and only returns `pending` until a separately verified purchase is linked to that exact buyer in DB.
- Five-device cap and one-purchase isolation depend on the existing adapter's SQL wrapper implemented in Task 5; simulated fake coverage does not substitute for SQL integration smoke.
- In-process rate limiter requires a shared store before horizontal scaling; do not release until that requirement and the dedicated DB EXECUTE grant are reviewed.
- No frontend checkout/code UI added; status/code display remains deferred until DB handoff and webhook Task 5 are approved.

## Files

Created `pdf_to_markdown/payments.cjs`, `pdf_to_markdown/payments.test.cjs`, `pdf_to_markdown/sql/020_checkout_status.sql`, `pdf_to_markdown/sql/920_checkout_status_test.sql`; modified `pdf_to_markdown/server.cjs`; created this report. Did not touch `.hermes/`.
