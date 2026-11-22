import { useEffect, useRef, useState } from 'react';

const copy = {
  de: {
    title: 'Unterstützen',
    story: 'Hi uch bin Marco und betreibe ein Einzelunternehmen. Ich bin mit meiner Family ständig in den roten Zahlen. Eure Donation würde also meinen 2 Kids, meiner Frau und mir sehr helfen. Vielen Dank',
    amount: 'Betrag', custom: 'Anderer Betrag', once: 'Einmalig',
    checkout: 'Weiter zur sicheren Zahlung', close: 'Schließen',
    error: 'Die Zahlung konnte nicht gestartet werden. Bitte erneut versuchen.',
    unavailable: 'Sichere Zahlungen sind in diesem Browser nicht verfügbar.',
  },
  en: {
    title: 'Support',
    story: "Hi, I'm Marco and I run a sole proprietorship. My family and I are constantly in the red. Your contribution would really help my two kids, my wife and me. Thank you very much.",
    amount: 'Amount', custom: 'Other amount', once: 'One-time',
    checkout: 'Continue to secure payment', close: 'Close',
    error: 'Payment could not be started. Please try again.',
    unavailable: 'Secure payments are unavailable in this browser.',
  },
};

export function donationLocale(languages) {
  const first = (Array.isArray(languages) ? languages[0] : languages) || navigator.language || 'en';
  const subtags = first.split('-');
  const region = subtags.find((part) => /^[A-Za-z]{2}$/.test(part) && part !== subtags[0]);
  if (region) return ['DE', 'AT', 'CH', 'LI'].includes(region.toUpperCase()) ? 'de' : 'en';
  return subtags[0].toLowerCase() === 'de' ? 'de' : 'en';
}

function stripeCheckoutUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com' &&
      !url.port && !url.username && !url.password && url.pathname !== '/';
  } catch (_) {
    return false;
  }
}

export default function DonationModal({ onClose, locale, navigate = (url) => window.location.assign(url) }) {
  const text = copy[locale === 'de' ? 'de' : 'en'];
  const dialog = useRef(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const [available, setAvailable] = useState(true);
  const [selection, setSelection] = useState('10');
  const [custom, setCustom] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const validCustom = /^(?:[5-9]|[1-9][0-9]|[1-4][0-9]{2}|500)$/.test(custom);
  const amountCents = selection === 'custom' ? (validCustom ? Number(custom) * 100 : null) : Number(selection) * 100;

  useEffect(() => {
    mounted.current = true;
    const node = dialog.current;
    if (typeof node.showModal !== 'function') {
      setAvailable(false);
      return;
    }
    node.showModal();
    return () => { mounted.current = false; if (node.open) node.close(); };
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (!available || inFlight.current || amountCents === null) return;
    inFlight.current = true;
    setLoading(true);
    setError(false);
    try {
      const response = await fetch('/api/donate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents, locale: locale === 'de' ? 'de' : 'en' }),
      });
      if (!response.ok) throw new Error('Checkout unavailable');
      const { url } = await response.json();
      if (!stripeCheckoutUrl(url)) throw new Error('Unsafe checkout URL');
      if (mounted.current) navigate(url);
    } catch (_) {
      setError(true);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  if (!available) return <div role="alert" className="donation-unavailable">{text.unavailable} <button type="button" onClick={onClose}>{text.close}</button></div>;

  return (
    <dialog ref={dialog} className="donation-modal" aria-modal="true" aria-labelledby="donation-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <button type="button" className="donation-close" onClick={onClose} aria-label={text.close}>×</button>
      <h2 id="donation-title">{text.title}</h2>
      <p>{text.story}</p>
      <form onSubmit={submit} noValidate aria-label={text.title}>
        <fieldset className="donation-amounts">
          <legend>{text.amount}</legend>
          <div className="donation-presets">
            {[5, 10, 20].map((amount) => (
              <button key={amount} type="button" aria-pressed={selection === String(amount)}
                onClick={() => { setSelection(String(amount)); setError(false); }}>€{amount}</button>
            ))}
          </div>
          <label htmlFor="donation-custom">{text.custom}</label>
          <div className="donation-custom-control">
            <span aria-hidden="true">€</span>
            <input id="donation-custom" type="text" inputMode="numeric" pattern="[0-9]*" value={custom}
              onChange={(event) => { setCustom(event.target.value); setSelection('custom'); setError(false); }} />
          </div>
        </fieldset>
        <p className="donation-once">{text.once} · Stripe</p>
        {error && <p role="alert" className="error-message">{text.error}</p>}
        <button className="primary donation-submit" type="submit" disabled={loading || amountCents === null}>{text.checkout}</button>
      </form>
    </dialog>
  );
}
