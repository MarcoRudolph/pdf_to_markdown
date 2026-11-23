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
