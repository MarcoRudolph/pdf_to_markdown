import { useEffect, useRef, useState } from 'react';
import DonationModal, { donationLocale } from './DonationModal';
import './App.css';

const LIMIT = 10 * 1024 * 1024;
const SOURCE = 'https://github.com/MarcoRudolph/pdf_to_markdown';
const formatFileLimit = bytes => Number.isFinite(bytes) && bytes > 0
  ? `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(bytes / 1048576)} MiB`
  : 'Limit nicht verfügbar';

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
      <p>Vermeiden Sie nach Möglichkeit vertrauliche Daten in hochgeladenen PDFs. Die App verwendet keine Analyse-Skripte oder Nutzerkonten. Für Kontingente setzt der Proxy jedoch einen technisch erforderlichen signierten Cookie <code>pdf2md_id</code> (HttpOnly, Secure, SameSite=Lax, Gültigkeit bis zu einem Jahr). Aus dessen zufälligem Wert wird ein pseudonymer Nutzer-Hash gebildet. Für die kostenlose Tagesgrenze wird außerdem die Client-IP mit einem geheimen Schlüssel und dem jeweiligen Kalendertag (Europe/Berlin) per HMAC-SHA256 gehasht; der Tageswert dient der Kontingentprüfung, nicht einer öffentlichen Identifikation. Die IP kann in Infrastruktur-/Uvicorn-Logs unabhängig davon erscheinen.</p>
      <h2>Kontingent, Zahlung und Wiederherstellung</h2>
      <p>Die App speichert in der Paygate-Datenbank pseudonyme Kontingent- und Nutzungsdaten sowie bei Käufen die von Stripe übermittelte E-Mail-Adresse, Stripe-Kauf-/Zahlungsreferenzen, Pass-Laufzeit, Nutzungswerte und einen Hash des kaufbezogenen Wiederherstellungscodes. Der Code ist bei bestätigter Zahlung mit derselben Zahlungsreferenz und dem ursprünglichen Cookie im Browser erneut abrufbar; bewahren Sie ihn trotzdem selbst sicher auf. Eine Checkout-Rückleitung allein bestätigt keine Zahlung. Bei Wiederherstellung wird der eingegebene Code serverseitig gehasht und der Pass mit dem aktuellen Cookie verknüpft. Stripe verarbeitet für den Checkout E-Mail-Adresse und Zahlungsdaten nach seinen eigenen Bedingungen; diese App speichert keine vollständigen Kartendaten. Der Checkout übermittelt eine pseudonyme Referenz an Stripe.</p>
      <p>Der Cookie hat eine maximale Lebensdauer von einem Jahr; ein Pass gilt 30 Tage ab Kauf. Diese Fristen sind <strong>keine</strong> automatische Löschfrist für Datenbankeinträge. Für Kauf-/Abrechnungsdaten, Code-Hashes, Nutzungswerte, technische Logs und Backups sind tatsächliche Aufbewahrungs- und Löschfristen noch festzulegen und rechtlich zu prüfen. Der Proxy schreibt keine eigenen Access-Logs, aber Uvicorn protokolliert standardmäßig Client-IP, Pfad und Status; vorgeschaltete Hosting-/TLS-Komponenten können weitere Logs führen. Die Status-URL wird nach Prüfung aus der Browseradresszeile entfernt; zuvor sichtbare Referenzen können in Browserhistorie oder Infrastruktur-Logs angefallen sein.</p>
      <h2>Freiwillige Unterstützung</h2>
      <p>Bei freiwilliger Unterstützung erstellt der Server über Stripe eine Zahlungsseite. Betrag und Sprache werden für die Zahlungsabwicklung an Stripe übertragen. Kartendaten geben Sie ausschließlich bei Stripe ein; sie gehen nicht durch unseren PDF-Proxy und werden nicht zusammen mit PDFs übertragen. Eine Unterstützung schaltet kein Kontingent frei. Nach der Rückkehr fragen wir den Zahlungsstatus über den Server bei Stripe ab. <a href="https://stripe.com/de/privacy">Stripe-Datenschutzhinweise</a>.</p>
      <h2>Rechtsgrundlagen und Empfänger</h2>
      <p>Die Verarbeitung erfolgt zur Bereitstellung des Konvertierungsdienstes, zur Verwaltung bezahlter Pässe und zur technischen Sicherheit. Empfänger sind der Zahlungsdienstleister Stripe (Checkout, Zahlungsabwicklung), der Betreiber der Paygate-PostgreSQL-Datenbank und die Hosting-/TLS-/Reverse-Proxy-Anbieter; konkrete Anbieter, Standorte, Drittlandübermittlungen und Verträge sind vor Betrieb einzutragen. Die einschlägigen Rechtsgrundlagen (z. B. Art. 6 Abs. 1 lit. b, c oder f DSGVO) einschließlich Cookie-Einordnung sind von einer Rechtsberatung für den tatsächlichen Betrieb zu prüfen; dieser Entwurf behauptet keine abschließende rechtliche Bewertung.</p>
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

function App({ navigate = url => window.location.assign(url) }) {
  const donationsEnabled = process.env.REACT_APP_DONATIONS_ENABLED === '1';
  const [donationOpen, setDonationOpen] = useState(false);
  const donateRef = useRef(null);
  const [donationReturn, setDonationReturn] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('donation') === 'cancel') return 'cancel';
    if (params.get('donation') === 'success') return params.get('session_id') ? 'checking' : 'unavailable';
    return null;
  });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!['success', 'cancel'].includes(params.get('donation'))) return;
    const scrub = () => window.history.replaceState(window.history.state, '', window.location.pathname);
    const sessionId = params.get('session_id');
    if (params.get('donation') !== 'success' || !sessionId) { scrub(); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let unmounted = false;
    async function verify() {
      let result = 'unavailable';
      try {
        const response = await fetch(`/api/donate/status?session_id=${encodeURIComponent(sessionId)}`, { credentials: 'same-origin', signal: controller.signal });
        if (!response.ok) throw new Error('Status unavailable');
        const body = await response.json();
        if (['paid', 'processing', 'incomplete', 'expired'].includes(body.status)) result = body.status;
      } catch (_) { /* neutral unavailable message */ }
      clearTimeout(timer);
      if (!unmounted) { scrub(); setDonationReturn(result); }
    }
    verify();
    return () => { unmounted = true; clearTimeout(timer); controller.abort(); };
  }, []);
  const returnMessages = {
    cancel: 'Zahlung abgebrochen. Es wurde keine Unterstützung bestätigt.',
    checking: 'Zahlungsstatus wird geprüft …',
    paid: 'Vielen Dank für Ihre Unterstützung! Ihre Zahlung wurde bestätigt.',
    processing: 'Die Zahlung wartet noch auf Bestätigung. Bitte prüfen Sie den Status später bei Stripe.',
    incomplete: 'Die Zahlung wurde nicht abgeschlossen.',
    expired: 'Die Zahlungssitzung ist abgelaufen.',
    unavailable: 'Der Zahlungsstatus ist derzeit nicht verfügbar oder nicht verifizierbar. Bitte prüfen Sie ihn bei Stripe.',
  };
  const [file, setFile] = useState(null);
  const [stage, setStage] = useState('empty');
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [quota, setQuota] = useState(null);
  const [quotaError, setQuotaError] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState('');
  const [restoreCode, setRestoreCode] = useState('');
  const [code, setCode] = useState('');
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [canRetryStatus, setCanRetryStatus] = useState(false);
  const checkStatusRef = useRef(null);
  const busy = useRef(false);
  const xhrRef = useRef(null);
  const urlRef = useRef(null);
  async function refreshQuota() {
    try {
      const response = await fetch('/v1/quota', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Quota unavailable');
      const data = await response.json();
      if (!data.free || !Array.isArray(data.paid)) throw new Error('Invalid quota');
      setQuota(data);
      setQuotaError(false);
    } catch {
      setQuota(null);
      setQuotaError(true);
    }
  }
  useEffect(() => {
    if (window.location.pathname === '/datenschutz' || window.location.pathname === '/impressum') return;
    let active = true;
    const lifecycle = new AbortController();
    refreshQuota();
    const location = new URL(window.location.href);
    const refs = location.searchParams.getAll('session_id');
    if (!refs.length || location.searchParams.has('donation')) return () => { active = false; };
    const scrub = () => {
      location.searchParams.delete('session_id');
      window.history.replaceState(window.history.state, '', location.pathname + location.search + location.hash);
    };
    if (refs.length !== 1 || !/^cs_[A-Za-z0-9_]{1,120}$/.test(refs[0])) {
      setPaymentMessage('Ungültige Zahlungsreferenz. Bitte kontaktieren Sie den Support.');
      scrub();
      return () => { active = false; };
    }
    async function fetchStatus() {
      const controller = new AbortController();
      let timer;
      let cancel;
      const deadline = new Promise((_, reject) => {
        cancel = () => {
          controller.abort();
          reject(new Error('Zahlungsstatus derzeit nicht verfügbar. Bitte erneut prüfen.'));
        };
        lifecycle.signal.addEventListener('abort', cancel, { once: true });
        timer = setTimeout(cancel, 4000);
      });
      try {
        const request = (async () => {
          const response = await fetch('/v1/checkout-status?session_id=' + encodeURIComponent(refs[0]), { credentials: 'same-origin', signal: controller.signal });
          if (!response.ok) throw new Error('Zahlungsstatus derzeit nicht verfügbar. Bitte später erneut prüfen oder Support kontaktieren.');
          return response.json();
        })();
        return await Promise.race([request, deadline]);
      } finally {
        clearTimeout(timer);
        lifecycle.signal.removeEventListener('abort', cancel);
      }
    }
    async function pauseBeforeRetry() {
      await new Promise(resolve => {
        let timer;
        const done = () => {
          clearTimeout(timer);
          lifecycle.signal.removeEventListener('abort', done);
          resolve();
        };
        lifecycle.signal.addEventListener('abort', done, { once: true });
        timer = setTimeout(done, 600);
      });
    }
    async function checkStatus() {
      setCanRetryStatus(false);
      setPaymentMessage('Zahlung wird geprüft …');
      let ready = false;
      try {
        for (let attempt = 0; attempt < 4 && active; attempt++) {
          const result = await fetchStatus();
          if (!active) return;
          if (result.status === 'ready' && typeof result.restore_code === 'string' && result.restore_code) {
            ready = true;
            setRestoreCode(result.restore_code);
            setPaymentMessage('Pass bestätigt. Wiederherstellungscode sicher aufbewahren – er wird nur hier angezeigt.');
            refreshQuota();
            return;
          }
          if (result.status !== 'pending') throw new Error('Zahlungsstatus derzeit nicht verfügbar. Bitte später erneut prüfen.');
          if (attempt < 3) await pauseBeforeRetry();
        }
        if (active) setPaymentMessage('Zahlung noch nicht bestätigt. Bitte später erneut prüfen oder Support kontaktieren.');
      } catch (err) {
        if (active) setPaymentMessage(err?.name === 'AbortError' ? 'Zahlungsstatus derzeit nicht verfügbar. Bitte erneut prüfen.' : err.message);
      } finally {
        if (active) { setCanRetryStatus(!ready); scrub(); }
      }
    }
    checkStatusRef.current = checkStatus;
    checkStatus();
    return () => { active = false; checkStatusRef.current = null; lifecycle.abort(); };
  // Runs once per page visit; session_id is not payment proof.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function buyPass() {
    if (paymentBusy) return;
    setPaymentBusy(true);
    setPaymentMessage('Checkout wird vorbereitet …');
    try {
      const response = await fetch('/v1/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: '{}' });
      if (!response.ok) throw new Error('Checkout derzeit nicht verfügbar. Bitte später erneut versuchen.');
      const result = await response.json();
      const destination = new URL(result.url);
      if (destination.protocol !== 'https:' || destination.hostname !== 'checkout.stripe.com' || destination.username || destination.password || destination.port) throw new Error('Checkout derzeit nicht verfügbar.');
      navigate(destination.href);
    } catch { setPaymentMessage('Checkout derzeit nicht verfügbar. Bitte später erneut versuchen.'); setPaymentBusy(false); }
  }

  async function redeem(event) {
    event.preventDefault();
    if (paymentBusy || !code.trim()) return;
    setPaymentBusy(true);
    setPaymentMessage('Pass wird geprüft …');
    try {
      const response = await fetch('/v1/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ code: code.trim() }) });
      if (!response.ok) throw new Error('Wiederherstellung derzeit nicht verfügbar. Bitte später erneut versuchen.');
      const result = await response.json();
      if (result.passes !== 1) throw new Error('Code ungültig oder Pass nicht verfügbar.');
      setCode('');
      setPaymentMessage('Pass wiederhergestellt. Kontingent wird aktualisiert.');
      await refreshQuota();
    } catch (err) { setPaymentMessage(err.message); }
    finally { setPaymentBusy(false); }
  }

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
        refreshQuota();
      } else {
        setStage(xhr.status === 402 ? 'payment' : 'error');
        setError(xhr.status === 402 ? 'Pass benötigt: Das verfügbare Kontingent reicht für diese PDF nicht aus.' : xhr.status === 503 ? 'Kontingent derzeit nicht verfügbar. Bitte später erneut versuchen.' : xhr.status === 413 ? 'Die PDF ist zu groß. Maximal 10 MiB sind erlaubt.' : xhr.status === 422 ? 'Diese PDF kann nicht umgewandelt werden. Bitte prüfen Sie Seitenzahl (maximal 100), Verschlüsselung und vorhandenen Text.' : xhr.status === 400 ? 'Die Datei ist keine gültige PDF. Bitte wählen Sie eine andere Datei.' : 'Die Umwandlung ist fehlgeschlagen. Bitte versuchen Sie es erneut.');
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
    <header className="site-header"><div className="header-inner"><a className="brand" href="/">PDF to Markdown</a><div className="header-actions"><a className="header-pass" href="/#pass">PDF-Pass ansehen</a>{donationsEnabled && <button ref={donateRef} className="donate" type="button" onClick={() => setDonationOpen(true)}>Donate</button>}</div></div></header>
    {donationOpen && donationsEnabled && <DonationModal locale={donationLocale(navigator.languages)} onClose={() => { setDonationOpen(false); donateRef.current?.focus(); }} />}
    {legal ? <Legal privacy={privacy} /> : <main className="landing content">
      {donationReturn && <p role={donationReturn === 'unavailable' ? 'alert' : 'status'} className="service-note">{returnMessages[donationReturn]}</p>}
      <div className="eyebrow">EINFACH. LESBAR. OFFEN.</div>
      <h1>Ihre PDF. Klar in Markdown.</h1>
      <p className="intro">Wandeln Sie textbasierte PDFs in gut lesbares Markdown um. Ohne Konto und ohne OCR – die PDF benötigt eine vorhandene Textebene.</p>
      <section className="quota-panel" aria-label="Ihr Kontingent">
        <div><strong>Ihr Kontingent heute</strong><p>{quotaError ? 'Kontingent derzeit nicht verfügbar. Bitte später erneut versuchen.' : quota ? <><span>{quota.free.units_left} PDFs frei</span><span>{quota.paid.reduce((total, pass) => total + (Number(pass.units_left) || 0), 0)} PDFs mit Pass</span></> : 'Kontingent wird geladen …'}</p></div>
        <p className="quota-limits">{quotaError ? 'Größenlimit derzeit nicht verfügbar' : quota ? <>{formatFileLimit(quota.free.limits?.max_file_bytes)} frei · {quota.paid.length ? `${[...new Set(quota.paid.map(pass => formatFileLimit(pass.limits?.max_file_bytes)))].join(' / ')} mit Pass` : 'kein aktiver Pass (Angebot: bis 10 MiB)'}</> : 'Größenlimit wird geladen …'}</p>
      </section>
      {paymentMessage && <div className="payment-message" role="status"><span>{paymentMessage}</span>{canRetryStatus && <button type="button" onClick={() => checkStatusRef.current?.()}>Zahlungsstatus erneut prüfen</button>}</div>}
      {restoreCode && <div className="restore-result"><strong>Wiederherstellungscode:</strong> <code>{restoreCode}</code><p>Bitte den Wiederherstellungscode sicher aufbewahren – er wird nur hier angezeigt.</p></div>}
      <section id="pass" className="pass-panel" aria-label="PDF-Pass">
        <div><span className="pass-kicker">MEHR SPIELRAUM</span><h2>PDF-Pass</h2><p className="pass-price">2 € / 50 PDFs pro Tag / 30 Tage</p><p>Einmalzahlung, kein Abo. Gilt für textbasierte PDFs bis 10 MiB und 100 Seiten.</p></div>
        <button className="primary" type="button" onClick={buyPass} disabled={paymentBusy}>Pass kaufen</button>
        <form className="restore-form" onSubmit={redeem}><label htmlFor="restore-code">Wiederherstellungscode eingeben</label><div><input id="restore-code" type="text" value={code} maxLength={128} autoComplete="off" onChange={event => setCode(event.target.value)} /><button type="submit" disabled={!code.trim() || paymentBusy}>Pass wiederherstellen</button></div></form>
      </section>
      <section className="converter" aria-label="PDF umwandeln">
        <div className={`status-illustration ${stage === 'success' ? 'is-success' : ''}`}>
          {stage === 'empty' || stage === 'selected' ? <svg viewBox="0 0 80 80" fill="none" aria-hidden="true"><path d="M24 12h22l14 14v39a5 5 0 0 1-5 5H24a5 5 0 0 1-5-5V17a5 5 0 0 1 5-5Z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/><path d="M46 12v14h14M27 38h26M27 47h20M27 56h15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg> : <StatusIcon kind={waiting ? 'waiting' : stage} />}
        </div>
        <div className="status-copy" role={waiting ? 'status' : undefined} aria-live="polite">
          <h2>{stage === 'uploading' ? 'PDF wird hochgeladen' : stage === 'processing' ? 'PDF wird verarbeitet' : stage === 'success' ? 'Markdown ist bereit' : stage === 'error' || stage === 'payment' ? 'Umwandlung nicht abgeschlossen' : 'PDF auswählen und umwandeln'}</h2>
          <p>{waiting ? 'Einen Moment bitte.' : stage === 'success' ? 'Ihre Datei steht jetzt zum Download bereit.' : stage === 'error' || stage === 'payment' ? 'Ihre Auswahl bleibt erhalten.' : 'Wählen Sie eine textbasierte PDF-Datei aus.'}</p>
        </div>
        <div className="form-area">
          <label className="file-label" htmlFor="pdf-file">to File</label>
          <input id="pdf-file" type="file" accept=".pdf,application/pdf" onChange={select} disabled={waiting} />
          <div className="selected-name" aria-live="polite">{file ? file.name : 'Noch keine PDF ausgewählt'}</div>
          <p className="file-hint">PDF mit Textebene · max. 10 MiB · maximal 100 Seiten (serverseitig geprüft) · keine OCR</p>
          {stage === 'uploading' && progress !== null && <p className="upload-progress">Upload: {progress} %</p>}
          {(stage === 'error' || stage === 'payment') && <p className="error-message" role="alert">{error}</p>}
          <div className="actions">
            {stage === 'success' ? <button className="primary" type="button" onClick={download}>Download</button> : stage === 'payment' ? <button className="primary" type="button" onClick={buyPass} disabled={paymentBusy}>Pass kaufen</button> : stage === 'error' && file && file.type === 'application/pdf' && file.name.toLowerCase().endsWith('.pdf') && file.size <= LIMIT ? <button className="primary" type="button" onClick={upload}>Erneut versuchen</button> : <button className="primary" type="button" onClick={upload} disabled={!file || stage === 'error' || waiting} aria-label={waiting ? 'Wird hochgeladen oder verarbeitet' : 'Upload'}>{waiting ? 'Bitte warten' : 'Upload'}</button>}
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
