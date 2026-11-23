# Task 6: Payment Gateway Operations

## Overview
Operational docs for the payment gateway in `pdf_to_markdown`.

## Architecture
- Ingress: Pinning configured for `/api/v1/checkout` and `/api/v1/webhook/stripe`.
- Identity Guards: Middleware applied to verify user context before interacting with Stripe.
- Webhooks: Stripe events (`checkout.session.completed`) trigger database state updates.

## Environment Setup
Required in `~/.hermes/.env` (or project `.env`):
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `DB_CONNECTION_STRING`

## SQL Migrations
Apply in order:
1. `sql/020_checkout_status.sql`
2. `sql/025_pdf2md_guards.sql`

## Maintenance
- Operator must audit failed payments daily.
- No live DB/Stripe interactions performed.

## Recovery secret and reversal monitoring
- `PAYGATE_CODE_SECRET` (the configured code secret) deterministically derives restore codes from Checkout session IDs. Keep it in the secret manager, not logs, Git or database; retain protected historical versions and backups for the lifetime of redeemable passes. Rotating or losing it without a migration/recovery plan changes the derived code and can prevent existing buyers from recovering/redeeming their passes. Plan rotation with an expiry/compatibility window and a verified customer recovery procedure; restrict and audit access to old versions.
- Monitor the restricted `paygate.pdf2md_webhook_anomalies` table by reason and count, plus webhook 5xx/retry backlog and unresolved delivery failures. Investigate spikes or persistent `invalid_provider_shape`, `price_mismatch`, `metadata_mismatch`, or `missing_email`; do not put raw event IDs, emails or payloads in alerts. Reconcile provider charge/PI amounts, currency and identity against purchases and tombstones before manual remediation.
- Reversal policy: a signed charge event is actionable only when its re-fetched charge matches the scoped PI and its **expanded latest charge** identity, and both are the €2/EUR product. A historical charge that is no longer latest, or missing/string/mismatched `latest_charge`, cannot be safely resolved by this handler: return retryable 503 and escalate persistent retries for provider investigation; never acknowledge or tombstone on an uncertain identity. Checkout pre/post checks likewise retry on uncertain provider state. This can require operator intervention if the latest charge has permanently changed.
- SQL guard smoke/concurrency tests and live Stripe delivery have **not** been run here: DB absent; DB operator approval and disposable-DB verification are prerequisites to deployment. No SQL migration was applied.
