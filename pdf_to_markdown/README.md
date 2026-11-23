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

`http://127.0.0.1:3001/` aus dem Browser aufrufen. Für die Entwicklung optional `npm start` auf Port 3000; CRA leitet `/v1/convert` an den Node-Proxy auf Port 3001 weiter. **Nie** den Token in `REACT_APP_*`, Frontend-Dateien, öffentlichen Environments oder URL-Parametern setzen. `API_URL` ist ausschließlich eine Server-Einstellung. Node verweigert den Start ohne Token. `HOST` ist standardmäßig `127.0.0.1` (kein öffentlicher Dienst).

**Paygate-Zwischenstand (Task 1):** `npm run serve` verlangt jetzt zusätzlich `PAYGATE_DATABASE_URL` (Loginrolle `paygate_pdf2md`), `PAYGATE_IP_SECRET`, `PAYGATE_CODE_SECRET`, `PAYGATE_COOKIE_SECRET` (drei unabhängig erzeugte Geheimnisse von mindestens 32 zufälligen Bytes), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `PUBLIC_BASE_URL` (HTTPS), `TRUSTED_PROXY_IP`. Der Start prüft die Rolle und die aktive `pdf2md`/`pass50`-Konfiguration in der Datenbank und verweigert Abweichungen. Der App-Dienst darf **nur** seine eigene Secret-Datei (Modus 600 in Verzeichnis Modus 700) lesen; niemals `/opt/paygate/.env`, da dort `POSTGRES_PASSWORD` liegt. Credentials nicht in Git oder Logs ablegen. Für den Testproxy ohne Paygate ist ausschließlich der explizite `testMode` der injizierten `createServer`-API vorgesehen, nicht der Produktionseinstieg. Uploads werden mit Paygate-Adapter bis zur Implementierung der Quota-Routen in Task 3 mit HTTP 503 gesperrt. Es gibt keinen unmetered Produktions-Fallback. Die Datenbank und dedizierte Rolle müssen separat bereitgestellt werden.

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

Der Upload ist clientseitig auf 10 MiB und serverseitig auf 10 MiB/100 Seiten begrenzt. Der Proxy erlaubt maximal 10 MiB plus 64 KiB Multipart-Overhead und streamt den Request, ohne ihn als Datei zu speichern. Er spiegelt keine Fehlertexte der API zurück. Die Python-API schreibt eine private temporäre PDF und entfernt sie nach Konvertierung/Fehler. Uvicorn führt standardmäßig Access-Logs, sofern sie nicht ausdrücklich deaktiviert werden. Das HTML benutzt keine externen Skripte/Fonts und setzt keine Cookies.

## Vor öffentlichem Deployment

Nicht ungeprüft öffentlich freigeben: HTTPS/TLS und Reverse-Proxy-Bodylimit, Timeout/Rate- und Concurrency-Limits, Missbrauchsschutz, Hosting-/Log-Retention und Auftragsverarbeiter sowie Rechtsgrundlage prüfen. Der AGPL-Quellcode-Link muss zur **exakten laufenden Version** samt Proxy/API, Lizenz- und Drittanbieterhinweisen führen. Derzeit zeigt er auf das Projekt-Repository; eine versionsgenaue öffentliche Release/Commit-URL ist vor Publikation zu prüfen. Die Rechtstexte sind Entwürfe und müssen rechtlich geprüft werden. Donate ist absichtlich deaktiviert.
