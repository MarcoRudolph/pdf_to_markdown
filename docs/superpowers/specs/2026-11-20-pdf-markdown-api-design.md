# PDF-zu-Markdown-API – Entwurf

## Absicht und Umfang

Eine auf dem VPS betriebene API soll der auf Cloudflare gehosteten Webapp eine PDF mit vorhandener Textebene in eine herunterladbare Markdown-Datei umwandeln. Der bereits bewährte Transkribierer aus `/root/backup/pdf_trans/deliverable/pdf-transkribieren/scripts/pdf_transkribieren.py` ist der unveränderte fachliche Kern. Eine Anbindung der Webapp ist nicht Teil dieses API-Arbeitspakets.

## Ziele, Nichtziele und Randbedingungen

- Ziel: dieselbe Leseordnung, Formatierung, Seitenmarkierungen und Warnungen wie `transcribe(Path) -> tuple[str, list[str]]` aus dem vorhandenen Skript; textbasierte PDFs, auch mehrspaltige.
- Kein OCR, keine Tabellenrekonstruktion, keine dauerhafte Speicherung, keine Jobs/Queue, keine Browser-Schlüssel, keine Änderung der React-App.
- `API/` liegt neben `pdf_to_markdown/` im bestehenden Repository. API und Frontend werden separat gebaut und deployt.
- Dateien bleiben nur während der Verarbeitung in einem privaten temporären Verzeichnis; keine Rohinhalte in Logs.
- Standardgrenzen für das MVP: höchstens 10 MiB PDF, höchstens 100 Seiten; beides konfigurierbar und dokumentiert. Bei ausschließlich leeren Seiten 422 statt eines scheinbar erfolgreichen Transkripts. Teilweise leere Seiten bleiben als Warnung im vom Skript erzeugten Markdown sichtbar.
- Produktionszugriff ausschließlich via TLS und einem serverseitig konfigurierten Bearer-Token; Cloudflare-Worker-Secret statt Token im React-Client. Bis eine Domain und der Worker bereit sind, kein ungeschützter öffentlicher Endpunkt.
- PyMuPDF 1.27.2.2 ist laut bestehendem Skript die benötigte Version. PyMuPDF wird unter AGPLv3 oder kommerziell angeboten: vor öffentlichem Produktivbetrieb Lizenzpflichten prüfen und erforderlichenfalls kommerzielle Lizenz klären. Die MIT-Lizenz dieses Repositorys allein erledigt das nicht.

## Ansätze

1. Bevorzugt: bestehendes Skript als lokale Kopie in `API/` versionieren und `transcribe()` direkt in einer kleinen FastAPI-Anwendung aufrufen. Klare Verantwortung, deterministische Version und keine Shell-/CLI-Kopplung.
2. Skript bei jedem Request als Unterprozess aus `/root/backup` ausführen. Weniger Codekopie, aber Host-Pfad und CLI-Dateiausgabe werden zur fragilen Laufzeitabhängigkeit; im Container unpraktisch.
3. Einen neuen Konverter schreiben. Verwirft getestete Funktionalität und schafft unnötige Abweichungen.

Der Benutzer hat die Wiederverwendung des bestehenden Skripts und einen API-Plan ausdrücklich vorgegeben; Ansatz 1 setzt das um. Die lokale Kopie wird mit Herkunft und Aktualisierungsregel dokumentiert; keine Änderungen an der Fachlogik im MVP.

## Schnittstelle und Laufzeit

- `POST /v1/convert`: `multipart/form-data` mit Feld `file`; `Authorization: Bearer <token>`; bei Erfolg `200`, `text/markdown; charset=utf-8`, `Content-Disposition: attachment; filename="document.md"`. Der Konverter arbeitet mit dem sicheren temporären Namen `document.pdf`; die YAML-Kopfzeile referenziert ihn. Der Client darf den Download lokal umbenennen.
- `GET /health`: nicht-sensitive Bereitschaftsantwort ohne Token; öffentlich allenfalls über den TLS-Reverse-Proxy.
- Fehler als JSON: 400 (fehlendes/falsches PDF), 401 (fehlendes/falsches Token), 413 (Größenlimit), 422 (verschlüsselt, beschädigt, reine Bildseiten oder Seitenlimit), 500 (unerwarteter interner Fehler ohne Dokumentinhalt im Response).
- Pro Request Byte-Limit beim streamweisen Lesen prüfen und vor Konvertierung Dateisignatur sowie Seitenzahl/Textebene validieren. HTTP-Proxy muss zusätzlich eine passende Request-Body-Grenze setzen, damit Multipart-Uploads nicht unbegrenzt vor dem Handler gepuffert werden.
- FastAPI + PyMuPDF, Tests mit pytest/httpx. Ein Docker-Image startet die API mit nicht-root Nutzer und begrenzter Workerzahl; lokal an `127.0.0.1` binden, öffentliche Route später via bestehendem Traefik. Produktions-Bearer-Token als Laufzeit-Secret, nie im Git oder Browser.

## Offene Betriebsentscheidung

Die konkrete API-Domain, Traefik-Route, Secret-Verwaltung und Cloudflare-Worker-Anbindung werden vor öffentlichem Deployment festgelegt. Auf diesem VPS sind 80/443 bereits von Traefik belegt; kein zweiter Listener darauf. Vor Produktionsstart Ressourcenbudget prüfen (bei Bestandsaufnahme waren 4 GiB Swap belegt) und einen Upload-/Latenztest mit realistischen PDFs ausführen.
