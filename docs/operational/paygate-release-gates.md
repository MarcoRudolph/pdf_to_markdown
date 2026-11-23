# Task 7 — lokale Verifikation und offene Release-Gates

Status: Keine öffentliche Freigabe. Staging-Stripe-Testmodus und Produktions-Cutover sind nicht autorisiert bzw. nicht konfiguriert; kein externer Stripe-Aufruf erfolgt. Die Rückfrage nach Testmodus-Staging wurde nicht beantwortet.

## Nachweise auf diesem Host
- Git: `main` liegt lokal vor `origin/main`; es wurde nichts gepusht oder deployed.
- Getrennte Test-DB: `/opt/paygate` mode 700, `.env` mode 600, `paygate-db` healthy und ausschließlich `127.0.0.1:5437` gebunden (5433 belegt). Handoff-Basis 001 und Seed 010, danach 020, 025 und zusätzliche verpflichtende 030 wurden nur dort angewendet.
- Vor 020/025 wurden die SQL-Tests mit fehlender Funktion RED; danach `920_checkout_status_test.sql` → `CHECKOUT STATUS TEST PASSED` + ROLLBACK; `925_pdf2md_guards_test.sql` → `PDF2MD GUARDS TEST PASSED` + ROLLBACK. Role-Probe: `paygate_pdf2md` kann generische Quotenfunktionen nicht ausführen, scoped `quota_pdf2md` schon.
- Zwei echte parallele psql-Sessions für dieselbe PaymentIntent-ID in beiden Reihenfolgen: jeweils ~1,5 s Advisory-Lock-Wartezeit; Fulfillment zuerst → Pass refunded/revoked, Reversal zuerst → Fulfillment NULL/kein Kauf. Synthetische Testzeilen bleiben nur auf der disposable DB.
- Letzter vollständiger Parent-Lauf nach Migration 030 und vor dem UI-Fix: 62 Node-Tests, 4 React-Tests, 29 API-Tests (eine Starlette/AnyIO-DeprecationWarning), Build erfolgreich. Nach UI-Änderung und Review-Fix vollständige Suite erneut laufen lassen; keine früheren Zahlen als aktuelle ausgeben.
- Browser-Preview des lokalen statischen Builds auf 390 px: kein horizontaler Überlauf, sichtbare Buttons 44–48 px hoch. Das war kein echter API-/Stripe-End-to-End-Test.

## Nicht erfüllt — Gate vor Veröffentlichung
- Keine `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `PAYGATE_DATABASE_URL`, `PUBLIC_BASE_URL`, `TRUSTED_PROXY_IP` in den untersuchten Projekt-/Hermes-Env-Dateien oder Prozessvariablen; kein Testmodus-Price-Abgleich, keine signierte Stripe-CLI-/Dashboard-Zustellung, keine Testzahlung, kein echtes UI→Node→DB→Stripe-E2E.
- Kein HTTPS-Staging-Ingress, keine reale Cloudflare-Header-Overwrite-/Peer-/Origin-Firewall-Prüfung, kein dediziertes nicht-root App-Secret/role-URL-Startup, keine off-host Backup/Restore-Probe. Kein DNS-/Live-Stripe-/Legal-/Lizenz-/Monitoring-Cutover freigegeben.
- `PAYGATE_CODE_SECRET` muss für bestehende Pässe erhalten bleiben; der aktuelle In-Process-Rate-Limiter ist nicht für horizontale Skalierung geeignet. Refund-RPCs sind ohne Reservierungs-ID nicht exakt-einmalig. Nicht als gelöst melden.
- Der öffentliche Checkout bleibt aus, bis Betreiber/Testmodus-Daten und Produktionsfreigabe vorliegen. Rollback bei späterem Cutover: letzten guten Web-Build routen, aber DB/Webhook für ausstehende Zahlungen und Reversals weiter betreiben; Daten und Secrets nicht löschen.
