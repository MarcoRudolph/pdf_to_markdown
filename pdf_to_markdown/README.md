# PDF to Markdown – Website

React-Landingpage (nur `/`) mit verlinktem Impressum (`/impressum`) und dienstspezifischer Datenschutzerklärung (`/datenschutz`). Die API wird ausschließlich über den gleichursprünglichen Node-Proxy `server.cjs` erreicht; der Browser kennt weder `API_TOKEN` noch die API-Adresse.

## Lokal starten

Python 3.11 und Node.js 22 (für ESM-Function-Tests) werden benötigt. Im Repository:

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

Der Token muss in diesem zweiten Terminal ebenfalls als `API_TOKEN` exportiert werden (z. B. über einen lokalen Secret-Manager); der Platzhalter darf nicht im Repository oder in der Shell-History landen.

`http://127.0.0.1:3001/` aus dem Browser aufrufen. Für die Entwicklung optional `npm start` auf Port 3000; CRA leitet `/v1/convert` an den Node-Proxy auf Port 3001 weiter. **Nie** den Token in `REACT_APP_*`, Frontend-Dateien, öffentlichen Environments oder URL-Parametern setzen. `API_URL` ist ausschließlich eine Server-Einstellung. Node verweigert den Start ohne Token. `HOST` ist standardmäßig `127.0.0.1` (kein öffentlicher Dienst).

## Tests

```bash
cd pdf_to_markdown
CI=true npm test -- --watch=false --runInBand
npm run test:proxy
node --test donation.test.mjs donation-pages.test.mjs
npm run build
cd ../API
.venv/bin/python -m pytest -q
# Bei laufender API und Website: testet echte generierte Text-PDF, Wiederholung,
# ungültige PDF, übergroßen Request, PDF ohne Textebene und Rechtsrouten.
.venv/bin/python tests/frontend_http.py
```

Der Upload ist clientseitig auf 10 MiB und serverseitig auf 10 MiB/100 Seiten begrenzt. Der Proxy erlaubt maximal 10 MiB plus 64 KiB Multipart-Overhead und streamt den Request, ohne ihn als Datei zu speichern. Er spiegelt keine Fehlertexte der API zurück. Die Python-API schreibt eine private temporäre PDF und entfernt sie nach Konvertierung/Fehler. Uvicorn führt standardmäßig Access-Logs, sofern sie nicht ausdrücklich deaktiviert werden. Das HTML benutzt keine externen Skripte/Fonts und setzt keine Cookies; der Zahlungsdialog lädt beim Öffnen kein Stripe-Skript.

## Donate: lokaler Test und Pages-Voraussetzungen

Ohne `REACT_APP_DONATIONS_ENABLED=1` ist Donate im Frontend ausdrücklich
deaktiviert (auch im Preview). Das Flag ist **kein Secret**, sondern ein
Build-Schalter. Mit Flag öffnet Donate einen Dialog; Checkout wird erst nach
ausdrücklicher Bestätigung gestartet. Ein Rücksprung mit `session_id` wird
serverseitig bei Stripe verifiziert: nur `paid` zeigt eine Bestätigung,
`processing`, `incomplete`, `expired` und Fehler bleiben neutral. Die
Session-ID wird nach dem Statusabruf aus der sichtbaren URL entfernt.

Für lokalen Testmodus `STRIPE_SECRET_KEY` (nur Testschlüssel) und
`DONATION_ORIGIN` serverseitig setzen, niemals in `REACT_APP_*`, Git oder
Shell-History. Bei direktem `npm run serve` ist die Browser-Origin
`http://127.0.0.1:3001`; für `npm start` ist sie `http://localhost:3000`
(CRA leitet `/api/donate` und `/api/donate/status` an Node auf Port 3001).
Die fest konfigurierte `DONATION_ORIGIN` muss zur Browser-Origin passen.
Test- und Live-Schlüssel getrennt halten. Ein Testmodus-Smoke-Test erfordert
eine **isolierte** Staging-Origin: falscher Origin-Header → 403, richtiger →
201 mit Stripe-Test-Checkout; dann mit Testkarte Rücksprung, Statuszustände,
Euro-Betrag, Produkt und URL-Bereinigung prüfen. Keine externen Test-Sessions
oder Zahlungen ohne ausdrückliche Freigabe. `.dev.vars` ist ignoriert;
`.dev.vars.example` kann eingecheckt werden, aber nie mit echten Geheimnissen.

Im Repository liegen `functions/api/donate.js` und
`functions/api/donate/status.js`; CRA erzeugt `build/` und kopiert
`public/_headers` nach `build/_headers` (`Referrer-Policy: no-referrer`).
**Nicht verifiziert:** tatsächliche Pages-Projektwurzel, Build-Output,
Deploy-Modus (Git oder Direct Upload), Produktionsbranch und ob Functions
mitdeployt werden. Diese Daten im Cloudflare-Dashboard read-only prüfen.
Wenn Direct Upload läuft, ist ein statischer Build allein keine Garantie für
Functions: vor Aktivierung Git-Integration oder einen bestätigten
Wrangler-Functions-Deploy vorsehen. Preview bleibt aus, sofern nicht eine
exakte, feste Test-Preview-Origin für `DONATION_ORIGIN` eingerichtet ist.
Vor Live-Betrieb serverseitige Pages-Bindings, Rate-Limit/Turnstile, Stripe
Radar, rechtliche Prüfung und ausgelieferten Referrer-Header verifizieren.
Der öffentliche PDF-Upload bleibt unabhängig davon ohne eigenen Proxy/API-
Deploy nicht verfügbar.

## Vor öffentlichem Deployment

Nicht ungeprüft öffentlich freigeben: HTTPS/TLS und Reverse-Proxy-Bodylimit, Timeout/Rate- und Concurrency-Limits, Missbrauchsschutz, Hosting-/Log-Retention und Auftragsverarbeiter sowie Rechtsgrundlage prüfen. Der AGPL-Quellcode-Link muss zur **exakten laufenden Version** samt Proxy/API, Lizenz- und Drittanbieterhinweisen führen. Derzeit zeigt er auf das Projekt-Repository; eine versionsgenaue öffentliche Release/Commit-URL ist vor Publikation zu prüfen. Die Rechtstexte sind Entwürfe und müssen rechtlich geprüft werden. Donate bleibt im Standard-Build deaktiviert.
