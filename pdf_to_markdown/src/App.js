import { useEffect, useRef, useState } from 'react';
import './App.css';

const LIMIT = 10 * 1024 * 1024;
const SOURCE = 'https://github.com/MarcoRudolph/pdf_to_markdown';

function StatusIcon({ kind }) {
  if (kind === 'success') return <svg viewBox="0 0 80 80" fill="none" aria-hidden="true"><circle cx="40" cy="40" r="30" stroke="currentColor" strokeWidth="3"/><path d="m23 40 12 12 23-25" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  if (kind === 'error') return <svg viewBox="0 0 80 80" fill="none" aria-hidden="true"><circle cx="40" cy="40" r="30" stroke="currentColor" strokeWidth="3"/><path d="M40 25v19" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/><circle cx="40" cy="54" r="2" fill="currentColor"/></svg>;
  return <svg className="waiting-arc" viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M32 9a23 23 0 1 0 23 23" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round"/></svg>;
}

function Legal({ privacy }) {
  return <main className="legal content">
    <a className="back-link" href="/">← Zurück zur Startseite</a>
    {privacy ? <>
      <h1>Datenschutzerklärung</h1>
      <p className="legal-note">Hinweis: Entwurf für diesen PDF-Dienst. Vor öffentlichem Betrieb rechtlich und anhand der konkreten Hosting-Konfiguration prüfen.</p>
      <h2>Verantwortlicher</h2>
      <p>Marco Rudolph, No de Halloh 8a, 25591 Ottenbüttel. Kontakt: <a href="mailto:MarcoRudolph09@proton.me">MarcoRudolph09@proton.me</a>, Tel. 04893 9373110.</p>
      <h2>Verarbeitung beim Besuch</h2>
      <p>Für die Auslieferung der Website und die Bearbeitung der Anfrage verarbeitet der Server technisch erforderliche Verbindungsdaten (insbesondere IP-Adresse, Zeitpunkt, aufgerufener Pfad, HTTP-Status und User-Agent). Der Node-Proxy dieser Anwendung schreibt keine eigenen Zugriffsprotokolle; Uvicorn führt standardmäßig Zugriffslogs mit Pfad, Status und Client-Adresse. Ob und wie lange Infrastruktur- oder Hosting-Logs gespeichert werden, hängt von der späteren Bereitstellung ab.</p>
      <h2>PDF-Konvertierung</h2>
      <p>Beim Upload wird die PDF über unseren gleichursprünglichen Server-Proxy an die Konvertierungs-API übertragen. Die API prüft Dateiformat, Größe und Seitenzahl und extrahiert die vorhandene Textebene (keine OCR). Die PDF liegt während der Verarbeitung in einem privaten temporären Verzeichnis und wird nach Erfolg oder Fehler entfernt. Die Markdown-Antwort wird an den Browser zurückgegeben und dort bis zum Wechsel der Datei beziehungsweise Verlassen der Seite für den Download vorgehalten. Der Proxy speichert keine Kopie der PDF oder der Markdown-Antwort dauerhaft.</p>
      <p>Vermeiden Sie nach Möglichkeit vertrauliche Daten in hochgeladenen PDFs. Diese App verwendet selbst keine Konten, Analyse-Skripte oder Cookies; zusätzliche Komponenten der künftigen Hosting-Umgebung sind damit nicht beschrieben.</p>
      <h2>Rechtsgrundlagen und Empfänger</h2>
      <p>Die Verarbeitung erfolgt zur Bereitstellung des ausdrücklich angeforderten Konvertierungsdienstes und zur technischen Sicherheit. Die einschlägige Rechtsgrundlage (insbesondere Art. 6 Abs. 1 lit. b oder f DSGVO) und etwaige Auftragsverarbeiter/Übermittlungen sind vor Veröffentlichung anhand des tatsächlichen Betriebs rechtlich zu prüfen.</p>
      <h2>Ihre Rechte</h2>
      <p>Sie haben nach Maßgabe der DSGVO Rechte auf Auskunft, Berichtigung, Löschung, Einschränkung und Datenübertragbarkeit sowie gegebenenfalls Widerspruch. Kontaktieren Sie dafür den Verantwortlichen. Außerdem besteht ein Beschwerderecht bei einer Datenschutzaufsichtsbehörde.</p>
      <h2>Vor Veröffentlichung zu klären</h2>
      <p>Hosting-Anbieter und Standorte, TLS-/Reverse-Proxy-Konfiguration, tatsächliche Access-/Error-Logs und deren Aufbewahrungsdauer, Schutz vor Missbrauch sowie die passende Rechtsgrundlage und Dienstleisterverträge. Es wird hier keine ungeprüfte Löschfrist für Logs behauptet.</p>
    </> : <>
      <h1>Impressum</h1>
      <h2>Angaben zum Betreiber</h2>
      <p>Marco Rudolph<br/>No de Halloh 8a<br/>25591 Ottenbüttel</p>
      <p>Telefon: <a href="tel:+4948939373110">04893 9373110</a><br/>E-Mail: <a href="mailto:MarcoRudolph09@proton.me">MarcoRudolph09@proton.me</a></p>
      <h2>Umsatzsteuer-ID</h2><p>DE455180377</p>
      <h2>Urheberrecht und Lizenzen</h2>
      <p>© 2026 Marco Rudolph. Der Quellcode dieser Version steht, sofern nicht anders angegeben, unter AGPL-3.0-only. Bestehende Urheberrechts- und Fremdlizenzhinweise gelten unverändert; insbesondere hat PyMuPDF eigene Lizenzbedingungen (AGPLv3 oder kommerziell). <a href={SOURCE}>Korrespondierender Quellcode und Lizenztext</a>.</p>
      <p className="legal-note">Vor Veröffentlichung: Betreiberangaben, gesetzliche Pflichtangaben und erreichbaren Quellcode der tatsächlich betriebenen Version rechtlich prüfen.</p>
    </>}
  </main>;
}

function App() {
  const [file, setFile] = useState(null);
  const [stage, setStage] = useState('empty');
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [downloadUrl, setDownloadUrl] = useState(null);
  const busy = useRef(false);
  const xhrRef = useRef(null);
  const urlRef = useRef(null);
  useEffect(() => () => {
    xhrRef.current?.abort();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  function select(event) {
    if (busy.current) return;
    const next = event.target.files?.[0] || null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setDownloadUrl(null);
    setProgress(null);
    setFile(next);
    setError('');
    if (!next) { setStage('empty'); return; }
    if (!next.name.toLowerCase().endsWith('.pdf') || next.type !== 'application/pdf') {
      setStage('error'); setError('Bitte wählen Sie eine PDF-Datei aus.');
    } else if (next.size > LIMIT) {
      setStage('error'); setError('Die PDF ist zu groß. Maximal 10 MiB sind erlaubt.');
    } else {
      setStage('selected');
    }
  }

  function upload() {
    if (!file || busy.current || !file.name.toLowerCase().endsWith('.pdf') || file.type !== 'application/pdf' || file.size > LIMIT) return;
    busy.current = true;
    setError('');
    setProgress(null);
    setStage('uploading');
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('POST', '/v1/convert');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) setProgress(Math.min(100, Math.floor(event.loaded * 100 / event.total)));
    };
    xhr.upload.onload = () => { setStage('processing'); setProgress(null); };
    xhr.onload = () => {
      busy.current = false;
      xhrRef.current = null;
      if (xhr.status === 200) {
        const url = URL.createObjectURL(new Blob([xhr.responseText], { type: 'text/markdown;charset=utf-8' }));
        urlRef.current = url;
        setDownloadUrl(url);
        setStage('success');
      } else {
        setStage('error');
        setError(xhr.status === 413 ? 'Die PDF ist zu groß. Maximal 10 MiB sind erlaubt.' : xhr.status === 422 ? 'Diese PDF kann nicht umgewandelt werden. Bitte prüfen Sie Seitenzahl (maximal 100), Verschlüsselung und vorhandenen Text.' : xhr.status === 400 ? 'Die Datei ist keine gültige PDF. Bitte wählen Sie eine andere Datei.' : 'Die Umwandlung ist fehlgeschlagen. Bitte versuchen Sie es erneut.');
      }
    };
    xhr.onerror = xhr.ontimeout = () => { busy.current = false; xhrRef.current = null; setStage('error'); setError('Der Dienst ist gerade nicht erreichbar. Bitte versuchen Sie es erneut.'); };
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  }

  function download() {
    if (!downloadUrl) return;
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = 'document.md';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  const privacy = window.location.pathname === '/datenschutz';
  const legal = privacy || window.location.pathname === '/impressum';
  const waiting = stage === 'uploading' || stage === 'processing';

  return <div className="site">
    <header className="site-header"><div className="header-inner"><a className="brand" href="/">PDF to Markdown</a><button className="donate" type="button" disabled aria-label="Donate – Demnächst verfügbar"><span>Donate</span><small>Demnächst verfügbar</small></button></div></header>
    {legal ? <Legal privacy={privacy} /> : <main className="landing content">
      <div className="eyebrow">EINFACH. LESBAR. OFFEN.</div>
      <h1>Ihre PDF. Klar in Markdown.</h1>
      <p className="intro">Wandeln Sie textbasierte PDFs in gut lesbares Markdown um. Ohne Konto und ohne OCR – die PDF benötigt eine vorhandene Textebene.</p>
      <section className="converter" aria-label="PDF umwandeln">
        <div className={`status-illustration ${stage === 'success' ? 'is-success' : ''}`}>
          {stage === 'empty' || stage === 'selected' ? <svg viewBox="0 0 80 80" fill="none" aria-hidden="true"><path d="M24 12h22l14 14v39a5 5 0 0 1-5 5H24a5 5 0 0 1-5-5V17a5 5 0 0 1 5-5Z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/><path d="M46 12v14h14M27 38h26M27 47h20M27 56h15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg> : <StatusIcon kind={waiting ? 'waiting' : stage} />}
        </div>
        <div className="status-copy" role={waiting ? 'status' : undefined} aria-live="polite">
          <h2>{stage === 'uploading' ? 'PDF wird hochgeladen' : stage === 'processing' ? 'PDF wird verarbeitet' : stage === 'success' ? 'Markdown ist bereit' : stage === 'error' ? 'Umwandlung nicht abgeschlossen' : 'PDF auswählen und umwandeln'}</h2>
          <p>{waiting ? 'Einen Moment bitte.' : stage === 'success' ? 'Ihre Datei steht jetzt zum Download bereit.' : stage === 'error' ? 'Ihre Auswahl bleibt erhalten. Sie können es erneut versuchen.' : 'Wählen Sie eine textbasierte PDF-Datei aus.'}</p>
        </div>
        <div className="form-area">
          <label className="file-label" htmlFor="pdf-file">to File</label>
          <input id="pdf-file" type="file" accept=".pdf,application/pdf" onChange={select} disabled={waiting} />
          <div className="selected-name" aria-live="polite">{file ? file.name : 'Noch keine PDF ausgewählt'}</div>
          <p className="file-hint">PDF mit Textebene · max. 10 MiB · maximal 100 Seiten (serverseitig geprüft)</p>
          {stage === 'uploading' && progress !== null && <p className="upload-progress">Upload: {progress} %</p>}
          {stage === 'error' && <p className="error-message" role="alert">{error}</p>}
          <div className="actions">
            {stage === 'success' ? <button className="primary" type="button" onClick={download}>Download</button> : stage === 'error' && file && file.type === 'application/pdf' && file.name.toLowerCase().endsWith('.pdf') && file.size <= LIMIT ? <button className="primary" type="button" onClick={upload}>Erneut versuchen</button> : <button className="primary" type="button" onClick={upload} disabled={!file || stage === 'error' || waiting} aria-label={waiting ? 'Wird hochgeladen oder verarbeitet' : 'Upload'}>{waiting ? 'Bitte warten' : 'Upload'}</button>}
          </div>
          {stage === 'success' && <p className="thanks">Vielen Dank, dass Sie PDF to Markdown genutzt haben. Empfehlen Sie uns weiter!</p>}
        </div>
      </section>
      <div className="service-note"><span className="note-symbol" aria-hidden="true">i</span><p>Nur vorhandener PDF-Text wird ausgelesen. Gescannte Seiten ohne Textebene können nicht umgewandelt werden.</p></div>
    </main>}
    <footer className="site-footer"><div className="footer-inner"><span className="footer-brand">Rudolph AI <span>· PDF to Markdown</span></span><nav aria-label="Rechtliches und Quellcode"><a href="/impressum">Impressum</a><a href="/datenschutz">Datenschutzerklärung</a><a href={SOURCE} target="_blank" rel="noopener noreferrer">AGPL-Quellcode ↗</a></nav></div></footer>
  </div>;
}

export default App;
