# PDF-zu-Markdown-API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine geschützte VPS-API konvertiert textbasierte PDF-Uploads mit dem bereits vorhandenen Transkribierer zu herunterladbarem Markdown.

**Architecture:** `API/` ist ein eigenständig baubares Python-Projekt neben `pdf_to_markdown/`. FastAPI validiert Upload und Limits, ruft die aus dem Backup übernommene `transcribe(Path)`-Funktion in einem privaten temporären Verzeichnis auf und liefert deren Markdown zurück. Separates Docker-Deployment hinter dem vorhandenen Traefik; Cloudflare-Worker-Anbindung folgt außerhalb dieses Plans.

**Tech Stack:** Python 3.11+, FastAPI, Uvicorn, python-multipart, PyMuPDF==1.27.2.2, pytest/httpx, Docker.

**Spec:** `docs/superpowers/specs/2026-11-20-pdf-markdown-api-design.md`

## Global Constraints

- Keine OCR, keine Tabellenrekonstruktion und keine dauerhafte Ablage; das React-Projekt bleibt unverändert.
- Fachlogik des vorhandenen `/root/backup/pdf_trans/deliverable/pdf-transkribieren/scripts/pdf_transkribieren.py` unverändert übernehmen und seine Herkunft im README dokumentieren.
- Ein Request: höchstens 10 MiB PDF und 100 Seiten, konfigurierbar via validierte Env-Variablen. `document.pdf` als sicherer temporärer Name; Download `document.md`.
- Bearer-Token nur in serverseitiger Laufzeitumgebung; keine produktive Freischaltung ohne TLS, Proxy-Body-Limit und Klärung der PyMuPDF-AGPL-/kommerziellen Lizenz.
- Für Fehler keine PDF-Inhalte, Stacktraces oder Token ausgeben oder loggen.

## Review Focus

- PDF mit leerer erster und textreicher zweiter Seite: Konvertierung gelingt und die Warnung bleibt im Markdown (Task 2).
- Nur Bildseiten/kein extrahierbarer Text: 422, nicht 200 mit nutzlosem Ergebnis (Task 2).
- Upload über dem Limit, auch bei fehlendem/gefälschtem `Content-Length`: 413 beim tatsächlichen Lesen (Task 2).
- Dateiname mit `../`, Anführungszeichen oder Unicode: keine Pfad- oder YAML-Injektion; fester interner Name (Task 2).
- Falsches/fehlendes Token: 401, vor Verarbeitung des Dokuments; keine Dateiinhalte in Logs (Task 2).

---

### Task 1: Transkribierer reproduzierbar in `API/` bereitstellen

**Files:**
- Create: `API/transcriber.py` (bytegleiche Kopie des bewährten Skripts)
- Create: `API/requirements.txt` (direkte Abhängigkeiten, Versionen gepinnt)
- Create: `API/tests/test_transcriber.py`
- Create: `API/README.md` (Herkunft, Kopier-/Update-Prozess und Hinweis auf unveränderte Fachlogik)

**Interfaces:**
- Consumes: das Skript aus dem Backup.
- Produces: `from transcriber import transcribe`; `transcribe(pdf_path: Path) -> tuple[str, list[str]]`.

- [ ] **Step 1: Write the failing test.** `test_transcribe_text_pdf`: eine zweitseitige textbasierte PDF mit PyMuPDF im Test erzeugen; `transcribe(path)` muss Seitenmarker `<!-- Seite 1 -->`/`<!-- Seite 2 -->`, beide Textinhalte und keine Warnungen liefern. `test_transcribe_empty_page_warning`: eine Seite ohne Textebene erzeugen und Warnung/Markdown-Marker nachweisen.
- [ ] **Step 2: Run tests to verify they fail.** `cd API && python -m pytest -q tests/test_transcriber.py` → Importfehler vor der Kopie.
- [ ] **Step 3: Implement.** Backup-Skript bytegleich nach `API/transcriber.py` kopieren; PyMuPDF exakt `1.27.2.2` in `requirements.txt` festlegen und README-Herkunft nennen. Testabhängigkeiten separat in `API/requirements-dev.txt` pinnen.
- [ ] **Step 4: Verify.** `cd API && python -m pytest -q tests/test_transcriber.py`; außerdem `cmp /root/backup/pdf_trans/deliverable/pdf-transkribieren/scripts/pdf_transkribieren.py API/transcriber.py` aus Repo-Root → beides erfolgreich. Test in einem eigenen venv ausführen, nicht in der Hermes-Laufzeitumgebung.
- [ ] **Step 5: Commit.** `git add API/transcriber.py API/requirements*.txt API/tests/test_transcriber.py API/README.md && git commit -m "feat(api): import validated PDF transcriber"`.

### Task 2: Geschützter Konvertierungs-Endpunkt

**Files:**
- Create: `API/app.py`
- Create: `API/tests/test_api.py`
- Modify: `API/README.md`

**Interfaces:**
- Consumes: `transcriber.transcribe(Path) -> tuple[str, list[str]]`.
- Produces: `app: FastAPI`; `GET /health`; `POST /v1/convert` mit Multipart-Feld `file`, `Authorization: Bearer <token>`; `200 text/markdown; charset=utf-8` mit `Content-Disposition: attachment; filename="document.md"`; JSON-Fehlercodes gemäß Spec.

- [ ] **Step 1: Write failing HTTP tests.** Mit `TestClient` und `monkeypatch` ein Test-Token setzen. Fälle: gültiges PDF mit Text und Seitenmarker (200 + Header + Inhalt), fehlender/falscher Bearer (401), fehlendes Upload-Feld und falscher MIME-/PDF-Header (400), kaputtes und verschlüsseltes PDF (422), rein bildbasiert/leere PDF (422), gemischt leer+Text (200 mit Warnung), 101 Seiten (422), 10 MiB + 1 Byte ohne `Content-Length` (413), gefährlicher Client-Dateiname ohne Durchschlagen in YAML/Pfad/Download (200), `GET /health` (200 ohne Token). Zusätzlich `test_temp_files_removed_after_success_and_error` mit gesetztem `TMPDIR` und `test_unexpected_error_is_redacted`.
- [ ] **Step 2: Verify red.** `cd API && python -m pytest -q tests/test_api.py` → `app`-Import schlägt fehl.
- [ ] **Step 3: Implement `app: FastAPI` in `API/app.py`.** Startkonfiguration: `API_TOKEN` muss beim Start gesetzt und nicht leer sein, `MAX_UPLOAD_BYTES` default `10485760`, `MAX_PAGES` default `100`, positive Ganzzahlen; keine Defaults für Secrets. Bearer per `hmac.compare_digest` prüfen. Multipart-Upload in Blöcken begrenzt in `TemporaryDirectory` als `document.pdf` schreiben (auch ohne `Content-Length`), PDF-Signatur `%PDF-` prüfen, mit PyMuPDF Seitenzahl und Verschlüsselung prüfen. Bei fehlender Textebene auf sämtlichen Seiten 422; bei gemischten Seiten `transcribe()` aufrufen und dessen Warnung im Markdown erhalten. `Response` aus UTF-8-Markdown mit festem Downloadnamen; PDF-Parser-Fehler nach 422, sonstige Fehler ohne interne Details nach 500. Dateinamen des Clients nicht im Dateisystem und nicht im YAML verwenden. Sync-Endpoint bzw. explizite Threadpool-Auslagerung, damit PDF-Arbeit nicht den Event Loop blockiert.
- [ ] **Step 4: Verify green and regressions.** `cd API && python -m pytest -q`; vorherige Transkribierer-Tests müssen ebenfalls grün sein. Zusätzlich eine echte textbasierte PDF außerhalb des Repos per TestClient hochladen und Markdown-Seitenmarker/erwarteten Text gegenprüfen; Test-PDF im Test erzeugen, nicht Kundendokumente einchecken.
- [ ] **Step 5: Commit.** `git add API/app.py API/tests/test_api.py API/README.md && git commit -m "feat(api): secure PDF upload and Markdown download"`.

### Task 3: Container und reproduzierbarer lokaler Smoke-Test

**Files:**
- Create: `API/Dockerfile`
- Create: `API/.dockerignore`
- Create: `API/compose.yaml` (localhost-Binding, Secret aus lokaler Env; keine echten Secrets im Git)
- Create: `API/.env.example`
- Create: `API/tests/smoke.py` (lokaler HTTP-Smoke-Test mit selbst erzeugter textbasierter PDF)
- Modify: `API/README.md`
- Modify: `.gitignore` (Python-Caches, venv, Testartefakte und Secrets)

**Interfaces:**
- Consumes: `app: FastAPI`, `API_TOKEN`, `MAX_UPLOAD_BYTES`, `MAX_PAGES`.
- Produces: Docker-Image auf nicht-root Benutzer; Compose mit `127.0.0.1:8000:8000`, Healthcheck und begrenzter Workerzahl; ein Smoke-Test gegen `http://127.0.0.1:8000`.

- [ ] **Step 1: Write failing deployment checks.** `tests/smoke.py` muss `/health` und authentifizierten Upload der selbst erzeugten PDF prüfen (200, Markdown und korrekter Dateiname); ohne laufenden Dienst schlägt er fehl. Separater statischer Check prüft, dass Compose nur `127.0.0.1` veröffentlicht und Dockerfile einen nicht-root `USER` hat.
- [ ] **Step 2: Verify red.** `cd API && python tests/smoke.py` ohne gestarteten Dienst → Verbindung schlägt fehl.
- [ ] **Step 3: Implement Docker/Compose/Docs.** Schlankes gepinntes Python-Basisimage, gepinnte Dependencies, nicht-root, `uvicorn app:app --host 0.0.0.0 --port 8000 --workers 1`; Compose nur localhost, Healthcheck; README mit venv-Setup, curl-Beispiel, Token-Generierung außerhalb Git, Limits, Rückgabe/Warnungen, Lizenzhinweis, TLS/Traefik- und Cloudflare-Worker-Anschluss sowie Betriebsgrenzen. `.dockerignore` muss `.env`, PDFs, Markdown-Testartefakte und venv ausschließen; das Root-`.gitignore` ebenso lokale Secrets/Caches schützen. Keine Domain oder Traefik-Labels erfinden.
- [ ] **Step 4: Verify.** `cd API && python -m pytest -q && docker compose config --quiet && docker compose up --build -d`; anschließend `python tests/smoke.py` mit lokalem Token; `docker compose ps` und `ss -ltnp` müssen Health und localhost-only-Port belegen. Anschließend gezielt nur diesen Test-Stack stoppen (`docker compose down`, niemals `-v`), sofern kein bestehender Dienst auf Port 8000 läuft. Bestehenden Dienst nicht überschreiben; bei Portkollision alternative lokale Test-Portbindung wählen.
- [ ] **Step 5: Commit.** `git add API/Dockerfile API/.dockerignore API/compose.yaml API/.env.example API/tests/smoke.py API/README.md .gitignore && git commit -m "build(api): package and smoke-test VPS service"`.

## Produktionsfreigabe (separat, nicht automatisch ausführen)

1. PyMuPDF-Lizenzmodell für den beabsichtigten öffentlichen SaaS-Betrieb mit dem Betreiber klären (AGPL-Pflichten erfüllen oder kommerzielle Lizenz); kein stillschweigender Schluss aus der MIT-Lizenz des Repos.
2. API-Domain, DNS, TLS/Traefik-Route, Request-Body-Limit einschließlich Multipart-Overhead, Proxy-Timeout, Rate-Limit und Token-Verwaltung festlegen. Die Container-Route bleibt bis dahin nur lokal.
3. Cloudflare-Worker als authentifizierten Upload-Proxy bauen; Token ausschließlich als Worker-Secret. React-App darf das Token nicht erhalten.
4. Auf dem VPS Ressourcen/Latenz unter realistischen Lastfällen prüfen (Swap war beim Planen vollständig belegt). Nach externer Freigabe HTTPS-Smoke-Test von außen, Negativtests für 401/413 und Verifikation, dass keine Secrets/Uploads persistieren.

## Self-Review

- Spec-Abdeckung: Endpunkte, unveränderter Konverter, Grenzen, Fehler, temporäre Dateien, Auth, Container, Lizenz- und Deployment-Gate in Tasks/Produktionsfreigabe erfasst.
- Typen/Interfaces: `transcribe(Path) -> tuple[str, list[str]]`, `app: FastAPI`, `file` und `API_TOKEN` konsistent.
- Review-Focus-Fälle jeweils in Task 2 getestet. Keine Cloudflare-/Traefik-Änderung als vorgetäuschte API-Aufgabe.
