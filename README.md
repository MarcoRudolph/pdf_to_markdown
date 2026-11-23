# PDF to Markdown

Eine Webanwendung, die **textbasierte PDF-Dateien in Markdown** umwandelt. Die
[Landing Page ansehen](https://pdf-to-markdown-8xk.pages.dev/).

## Was die Anwendung kann

- PDF mit vorhandener Textebene hochladen und den extrahierten Text als
  `document.md` herunterladen; **keine OCR** für eingescannte Seiten.
- Upload-Fortschritt, Verarbeitungsstatus und verständliche Fehlermeldungen
  anzeigen. Erneuter Versuch mit derselben oder einer anderen Datei ist möglich.
- Dateien auf **10 MiB** und **100 Seiten** begrenzen (die Seitenzahl prüft die API).
- Impressum und Datenschutzerklärung anzeigen. Der Donate-Button ist derzeit
  deaktiviert.

**Stand der öffentlichen Seite:** Cloudflare Pages liefert derzeit nur das
statische Frontend. Der Upload funktioniert dort **noch nicht**, weil der
Node-Proxy und die Python-API nicht öffentlich angebunden sind. Lokal kann die
vollständige Konvertierung mit beiden Diensten betrieben werden. Die Rechtstexte
sind Entwürfe und vor einem öffentlichen Produktivbetrieb zu prüfen.

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
  derzeit ohne den Node-/Python-Dienst.
- **Tests:** React Testing Library/Jest, Node.js-Test-Runner und pytest.

Quellcode und Details: [`pdf_to_markdown/README.md`](pdf_to_markdown/README.md)
für Website und lokalen Start, [`API/README.md`](API/README.md) für API und
Betriebsgrenzen.

## Freiwillige Unterstützung (noch nicht live freigegeben)

Donate läuft ausschließlich über den Node-Paygate-Server (`/api/donate`,
`/api/donate/status`), nicht über Cloudflare Pages Functions. Es ist doppelt
deaktiviert, bis beides gesetzt ist: `REACT_APP_DONATIONS_ENABLED=1` im
Frontend-Build (kein Secret) und `DONATIONS_ENABLED=1` am Server. Der Checkout
nutzt `STRIPE_SECRET_KEY` und als Rücksprung-Origin `PUBLIC_BASE_URL`; der
Origin-Header muss exakt passen, Anfragen sind pro Client rate-limitiert. Eine
Spende schaltet kein Kontingent frei; der Pass-Webhook ignoriert
Spenden-Sessions (`metadata.donation_context`). Vor live: Rechtstexte freigeben,
Stripe Radar prüfen, Testmodus-Smoke-Test in Staging. Keine Live-Zahlung ohne
gesonderte Zustimmung.

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
