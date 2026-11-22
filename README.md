# PDF to Markdown

Eine Webanwendung, die **textbasierte PDF-Dateien in Markdown** umwandelt. Die
[Landing Page ansehen](https://pdf-to-markdown-8xk.pages.dev/).

## Was die Anwendung kann

- PDF mit vorhandener Textebene hochladen und den extrahierten Text als
  `document.md` herunterladen; **keine OCR** für eingescannte Seiten.
- Upload-Fortschritt, Verarbeitungsstatus und verständliche Fehlermeldungen
  anzeigen. Erneuter Versuch mit derselben oder einer anderen Datei ist möglich.
- Dateien auf **10 MiB** und **100 Seiten** begrenzen (die Seitenzahl prüft die API).
- Impressum und Datenschutzerklärung anzeigen. Donate ist im Standard-Build
  deaktiviert; ein expliziter Test-/Staging-Build kann den Zahlungsdialog aktivieren.

**Stand der öffentlichen Seite:** Cloudflare Pages liefert derzeit nur das
statische Frontend. Der Upload funktioniert dort **noch nicht**, weil der
Node-Proxy und die Python-API nicht öffentlich angebunden sind. Lokal kann die
vollständige Konvertierung mit beiden Diensten betrieben werden. Die Rechtstexte
sind Entwürfe und vor einem öffentlichen Produktivbetrieb zu prüfen.
Im Repository liegen Pages Functions unter `pdf_to_markdown/functions/api/donate*`
und der CRA-Build entsteht unter `pdf_to_markdown/build/`. Die tatsächliche
Pages-Dashboard-Konfiguration (Projektwurzel, Build-Ausgabe, Git-Integration
oder Direct Upload, Produktionsbranch und Functions-Bereitstellung) ist **nicht
verifiziert**; sie muss vor dem Aktivieren im Dashboard geprüft werden. Ein
statischer Upload des Build-Ordners allein beweist keine Functions-Bereitstellung.

## Technologie und Aufbau

- **Frontend:** React 19, JavaScript, CSS und Create React App (`react-scripts`).
  Der Browser sendet Uploads an den gleichursprünglichen Pfad `/v1/convert`.
- **Proxy:** Node.js mit eingebautem `http`-Modul (`pdf_to_markdown/server.cjs`).
  Er liefert lokal das gebaute Frontend aus und leitet Uploads an die API weiter.
  Der API-Bearer-Token bleibt ausschließlich auf dem Server.
- **API:** Python 3.11, FastAPI und Uvicorn (`API/`). Sie validiert Uploads und
  wandelt die vorhandene PDF-Textebene mit **PyMuPDF** in Markdown um. PDFs
  werden nur temporär für die Verarbeitung gespeichert und danach entfernt.
- **Deployment der Vorschauseite:** Statischer React-Build auf Cloudflare Pages;
  derzeit ohne den Node-/Python-Dienst. Donations-Flag im Preview standardmäßig aus.
- **Tests:** React Testing Library/Jest, Node.js-Test-Runner und pytest.

Quellcode und Details: [`pdf_to_markdown/README.md`](pdf_to_markdown/README.md)
für Website und lokalen Start, [`API/README.md`](API/README.md) für API und
Betriebsgrenzen.

## Freiwillige Unterstützung (noch nicht live freigegeben)

`REACT_APP_DONATIONS_ENABLED=1` aktiviert Donate **nur im gebauten Frontend**;
ohne den Wert bleibt der Button deaktiviert. Ein Checkout benötigt zusätzlich
die serverseitigen Bindings `STRIPE_SECRET_KEY` und `DONATION_ORIGIN`, die
gleichzeitig mit den Pages Functions bereitgestellt werden müssen. Test- und
Live-Schlüssel strikt trennen. Preview bleibt aus, sofern nicht eine feste
Test-Preview-Origin exakt als `DONATION_ORIGIN` konfiguriert ist; immutable
Preview-URLs dürfen nicht stillschweigend dieselbe Origin verwenden. `public/_headers`
wird von CRA nach `build/_headers` kopiert; `Referrer-Policy: no-referrer` muss
am **ausgelieferten** Pages-HTML geprüft werden.

Lokal ist `http://localhost:3000` mit `npm start` und CRA-Proxy eine andere
Origin als direktes Node-Serving auf `http://127.0.0.1:3001`; `DONATION_ORIGIN`
muss jeweils genau der im Browser verwendeten Origin entsprechen. Ein Testmodus-
Smoke-Test in einem isolierten Staging-Projekt prüft nach expliziter Freigabe
falsche Origin (403), richtige Origin (201), Checkout-Rückkehr auf die gleiche
Origin, Status `processing`/`incomplete`/`expired`/`paid`, URL-Bereinigung,
Testbetrag und Währung. Vor live: Pages-Modus und Bindings lesen, WAF-Rate-Limit
oder serverseitig verifiziertes Turnstile sowie Stripe Radar prüfen, Rechtstexte
freigeben und Keyboard-/Mobile-/Screenreader-Test durchführen. Keine Live-Zahlung
ohne gesonderte Zustimmung.

## Lizenz

Copyright (C) 2026 Marco Rudolph. Der Quellcode dieser aktuellen Version steht,
soweit einzelne Dateien nichts anderes angeben, unter der GNU Affero General
Public License Version 3 (AGPL-3.0-only). Den vollständigen Lizenztext und die
Urheberrechts- und Lizenzhinweise enthält [LICENSE](LICENSE). Frühere unter MIT
veröffentlichte Versionen behalten die damals gewährten Rechte. Abhängigkeiten
und Fremd-Assets behalten ihre jeweiligen eigenen Lizenzbedingungen.

Die API befindet sich unter [`API/`](API/). Wird eine modifizierte AGPL-gedeckte
Version öffentlich als SaaS betrieben, muss der tatsächlich verwendete
korrespondierende Quellcode den Nutzern über einen gut sichtbaren Hinweis am
Dienst zugänglich sein. Ein öffentliches Repository allein ersetzt diesen
Hinweis nicht.
