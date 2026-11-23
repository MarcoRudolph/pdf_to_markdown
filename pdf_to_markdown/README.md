# PDF to Markdown – Website

React-Landingpage (nur `/`) mit verlinktem Impressum (`/impressum`) und dienstspezifischer Datenschutzerklärung (`/datenschutz`). Die API wird ausschließlich über den gleichursprünglichen Node-Proxy `server.cjs` erreicht; der Browser kennt weder `API_TOKEN` noch die API-Adresse.

## Lokal starten

Python 3.11 und Node.js werden benötigt. Im Repository:

```bash
cd API
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
export API_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000
```

In einem zweiten Terminal mit **demselben serverseitigen** `API_TOKEN`:

```bash
cd pdf_to_markdown
npm ci
npm run build
API_URL=http://127.0.0.1:8000 PORT=3001 npm run serve
```

Der Token muss in diesem zweiten Terminal ebenfalls als `API_TOKEN` exportiert werden (z. B. über einen lokalen Secret-Manager); der Platzhalter darf nicht im Repository oder in der Shell-History landen. Das oben gezeigte Startbeispiel allein reicht seit Task 1 nicht mehr: Paygate-Konfiguration und eine erreichbare Datenbank sind zusätzlich Pflicht (siehe unten).

Für Paygate-Integrationsbetrieb statt `http://127.0.0.1:3001/` einen lokalen HTTPS-Reverse-Proxy mit passendem `PUBLIC_BASE_URL`, `TRUSTED_PROXY_IP` und erreichbarem DB-/Stripe-Test-Setup verwenden; der HTTP-Loopback-Aufruf ist nur für isolierte statische/Proxy-Tests geeignet, **nicht** für POST-Kauf oder Upload mit Origin-Schutz und Secure-Cookie. Für die Entwicklung optional `npm start` auf Port 3000; CRA leitet `/v1/*` an den Node-Proxy auf Port 3001 weiter, aber ein abweichender CRA-Origin ist im normalen Paygate-Betrieb nicht als POST-Origin freigegeben. **Nie** den Token in `REACT_APP_*`, Frontend-Dateien, öffentlichen Environments oder URL-Parametern setzen. `API_URL` ist ausschließlich eine Server-Einstellung. Node verweigert den Start ohne Token. `HOST` ist standardmäßig `127.0.0.1` (kein öffentlicher Dienst).

**Paygate-Betrieb:** `npm run serve` verlangt `PAYGATE_DATABASE_URL` (Loginrolle `paygate_pdf2md`, DB `paygate`), `PAYGATE_IP_SECRET`, `PAYGATE_CODE_SECRET`, `PAYGATE_COOKIE_SECRET` (drei unabhängig erzeugte Geheimnisse von mindestens 32 zufälligen Bytes), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `PUBLIC_BASE_URL` (HTTPS ohne Pfad) und `TRUSTED_PROXY_IP`; außerdem `API_TOKEN`. Optionale serverseitige Werte: `API_URL` (Default `http://127.0.0.1:8000`), `HOST` (Default `127.0.0.1`), `PORT` (Default `3001`). Diese Werte gehören **nur** in den Serverprozess, nicht in CRA-Variablen. Stripe-Testschlüssel mit **Test-Price-ID** und dem Signing Secret des **Test-Webhook-Endpunkts** `/v1/stripe/webhook` nur zusammen verwenden; Live-Schlüssel, Live-Price-ID und Live-Webhook-Secret sind eine getrennte Konfiguration. Price: einmalig 2 EUR (`pass50`, 50 PDFs je Berliner Kalendertag, 30 Tage), nicht Subscription. Webhook-Ereignisse und Refund/Dispute-Abgleich vor Freigabe end-to-end im Testmodus prüfen; keine Produktionszahlung in dieser Anleitung.

Der Start prüft Rolle, Privilegien der Migration `sql/030_pdf2md_scoped_quota.sql` sowie aktive `pdf2md`/`pass50`-Produktwerte und verweigert Abweichungen. Schema/Basis, Seed, 020, 025 und 030 müssen vom Datenbankbetreiber in dieser Reihenfolge bereitgestellt werden; **diese README führt keine Migration aus**. `PAYGATE_DATABASE_URL` muss den App-Login `paygate_pdf2md` enthalten, niemals die Superuser-Rolle. Dedizierte App-Secret-Datei (Modus 600 in Verzeichnis 700), getrennt von der root-exklusiven `/opt/paygate/.env` mit `POSTGRES_PASSWORD`. Port `5433` nur verwenden, wenn die vorgesehene DB dort läuft; vor Bindung auf Kollisionen mit bestehenden PostgreSQL-Diensten prüfen, nicht einen laufenden Dienst ersetzen. Kein DB-Zugriff für eine statische Cloudflare-Pages-Bereitstellung: die bezahlte UI darf nur mit dem funktionierenden Node-Proxy, API und Paygate veröffentlicht werden. Für Tests ohne Paygate gibt es nur den expliziten injizierten `testMode` der `createServer`-API, nicht den Produktionseinstieg. Kein ungemessener Fallback.

Der TLS-Reverse-Proxy muss HTTPS terminieren, die tatsächliche Client-IP über genau einen vertrauenswürdigen `CF-Connecting-IP`-Header liefern und von der in `TRUSTED_PROXY_IP` eingetragenen IP kommen; fremde/mehrfache Header nicht blind weiterreichen. `PUBLIC_BASE_URL` muss exakt dem öffentlichen Origin entsprechen (POST-Origin-Schutz). Limitierung von Bodygröße, Timeouts, Rate/Concurrency, Healthchecks, Datenbank-Backups und Restore-Tests im Deployment festlegen. Ein einzelner Node-Prozess begrenzt Zahlungsaufrufe im Speicher; mehrere Instanzen brauchen einen gemeinsamen Limiter.


## Tests

```bash
cd pdf_to_markdown
CI=true npm test -- --watch=false --runInBand
npm run test:proxy
npm run build
cd ../API
.venv/bin/python -m pytest -q
# Bei laufender API und Website: testet echte generierte Text-PDF, Wiederholung,
# ungültige PDF, übergroßen Request, PDF ohne Textebene und Rechtsrouten.
.venv/bin/python tests/frontend_http.py
```

Der Upload ist clientseitig auf 10 MiB begrenzt; serverseitig sind kostenlos höchstens 1 MiB, mit aktivem Pass höchstens 10 MiB und in der Python-API maximal 100 Seiten zulässig. Kein OCR. Der Proxy erlaubt maximal 10 MiB plus 64 KiB Multipart-Overhead, streamt den Request ohne Dateispeicherung und spiegelt API-Fehlertexte nicht zurück. Die Python-API schreibt eine private temporäre PDF und entfernt sie nach Konvertierung/Fehler. Uvicorn führt standardmäßig Access-Logs. Der Proxy setzt einen signierten, HttpOnly/Secure/SameSite=Lax-Kontingent-Cookie; Details und offene Retention-Fragen stehen im Datenschutz-Entwurf.

## Donate (lokaler Test)

Standardmäßig aus. Für einen lokalen Testmodus `REACT_APP_DONATIONS_ENABLED=1`
beim Build/`npm start` und `DONATIONS_ENABLED=1` für `npm run serve` setzen;
`STRIPE_SECRET_KEY` muss ein **Testschlüssel** sein und gehört nie in
`REACT_APP_*`, Git oder Shell-History. Der Checkout akzeptiert nur den exakten
Origin aus `PUBLIC_BASE_URL` und leitet dorthin zurück
(`/?donation=success&session_id=…` bzw. `/?donation=cancel`). Der Status wird
serverseitig bei Stripe geprüft; nur `paid` zeigt einen Dank, die Session-ID
wird danach aus der URL entfernt. Spenden-Rückleitungen lösen nie die
Pass-Statusprüfung aus.

## Vor öffentlichem Deployment

**Nicht als statische Cloudflare-Pages-Seite mit zahlungspflichtigen Aussagen veröffentlichen.** Der tatsächlich ausgelieferte Build muss zusammen mit dem Node-Proxy, der Python-API und der migrierten Paygate-Datenbank laufen. Test-/Live-Checkout und Webhook getrennt prüfen; Zahlungen, Erstattungen, Chargebacks, fehlgeschlagene Webhooks sowie unklare Upstream-Konvertierungen gegen Kontingent-Reservierungen abstimmen. Bei Fehlern paid Checkout sperren/Deployment zurückrollen, ohne vorhandene Kauf-/Nutzungsdaten zu löschen; Reconciliation dokumentieren und vor Wiederfreigabe nachholen. DB-/Secret-Rotation, Backups und Wiederherstellung separat planen. HTTPS/TLS, Body-Limit, Timeout/Rate/Concurrency, Missbrauchsschutz und Logs prüfen. Vor Veröffentlichung Aufbewahrungsfristen, Auftragsverarbeiter und Rechtsgrundlagen verbindlich festlegen und Datenschutz/Impressum rechtlich prüfen. Der AGPL-Quellcode-Link muss auf eine **exakte öffentlich erreichbare Release- oder Commit-Version** samt Proxy/API, Lizenz- und Drittanbieterhinweisen verweisen; der derzeitige Repository-Link ist nicht versionsgenau. Kein Produktions- oder Stripe-Live-Deployment durch diese Aufgabe.
