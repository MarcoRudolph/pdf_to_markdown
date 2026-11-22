import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import DonationModal, { donationLocale } from './DonationModal';

const germanCopy = 'Hi uch bin Marco und betreibe ein Einzelunternehmen. Ich bin mit meiner Family ständig in den roten Zahlen. Eure Donation würde also meinen 2 Kids, meiner Frau und mir sehr helfen. Vielen Dank';
const englishCopy = "Hi, I'm Marco and I run a sole proprietorship. My family and I are constantly in the red. Your contribution would really help my two kids, my wife and me. Thank you very much.";
const navigate = jest.fn();
const onClose = jest.fn();
const show = (locale = 'de') => render(<DonationModal locale={locale} onClose={onClose} navigate={navigate} />);
const submit = () => fireEvent.click(screen.getByRole('button', { name: /weiter zur sicheren zahlung|continue to secure payment/i }));

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});
afterEach(() => { delete global.fetch; });

test.each([
  [['de-DE'], 'de'], [['en-DE'], 'de'], [['de-AT'], 'de'], [['fr-CH'], 'de'],
  [['de-CH'], 'de'], [['de-LI'], 'de'], [['en-US'], 'en'], [['fr-FR'], 'en'],
  [['de-US'], 'en'], [['de'], 'de'], [['en-US', 'de-DE'], 'en'],
  [['de-419'], 'en'], [['de-Latn-419'], 'en'],
])('first browser locale %j resolves to %s', (languages, expected) => {
  expect(donationLocale(languages)).toBe(expected);
});

test('dialog own sizing rule includes padding and border within viewport width and height limits', () => {
  // Isolate the dialog rule: the global * reset must not mask a missing dialog box-sizing.
  const source = readFileSync(join(__dirname, 'App.css'), 'utf8');
  const stylesheet = document.createElement('style');
  stylesheet.textContent = source;
  document.head.appendChild(stylesheet);
  try {
    const rule = Array.from(stylesheet.sheet.cssRules).find((entry) => entry.selectorText === '.donation-modal');
    expect(rule).toBeDefined();
    const isolated = document.createElement('style');
    isolated.textContent = rule.cssText;
    document.head.appendChild(isolated);
    const dialog = document.createElement('dialog');
    dialog.className = 'donation-modal';
    document.body.appendChild(dialog);
    try {
      // Remove global styles; only the dialog's own declaration should set sizing.
      stylesheet.remove();
      const computed = getComputedStyle(dialog);
      expect(computed.boxSizing).toBe('border-box');
      // JSDOM cannot compute min()/dvh; retain the parsed viewport constraints.
      expect(rule.style.getPropertyValue('width')).toBe('min(520px, calc(100vw - 32px))');
      expect(rule.style.getPropertyValue('max-height')).toBe('calc(100dvh - 32px)');
    } finally {
      dialog.remove();
      isolated.remove();
    }
  } finally {
    stylesheet.remove();
  }
});

test('missing language list falls back to navigator.language', () => {
  const language = jest.spyOn(navigator, 'language', 'get').mockReturnValue('de-AT');
  try { expect(donationLocale([])).toBe('de'); }
  finally { language.mockRestore(); }
});

test('without native showModal, shows an unavailable message rather than a non-modal checkout', () => {
  const showModal = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = undefined;
  try {
    show();
    expect(screen.getByRole('alert')).toHaveTextContent(/nicht verfügbar/i);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Weiter zur sicheren Zahlung' })).not.toBeInTheDocument();
  } finally { HTMLDialogElement.prototype.showModal = showModal; }
});

test('strict-mode effect replay keeps the dialog open', () => {
  render(<StrictMode><DonationModal locale="de" onClose={onClose} navigate={navigate} /></StrictMode>);
  expect(screen.getByRole('dialog', { name: 'Unterstützen' })).toHaveAttribute('open');
});

test.each([
  ['de', germanCopy, 'Unterstützen', 'Betrag', 'Anderer Betrag', 'Einmalig', 'Schließen'],
  ['en', englishCopy, 'Support', 'Amount', 'Other amount', 'One-time', 'Close'],
])('shows exact %s copy and an accessible native dialog', (locale, copy, title, amount, custom, oneTime, close) => {
  show(locale);
  const dialog = screen.getByRole('dialog', { name: title });
  expect(dialog).toHaveAttribute('open');
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
  expect(screen.getByText(copy)).toBeInTheDocument();
  expect(screen.getByText(amount)).toBeInTheDocument();
  expect(screen.getByLabelText(custom)).toBeInTheDocument();
  expect(screen.getByText(new RegExp(`^${oneTime}`))).toBeInTheDocument();
  expect(screen.getByText(/stripe/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: close })).toBeInTheDocument();
});

test('initial €10 preset posts cents and locale, then navigates only to Stripe checkout', async () => {
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/abc' }) });
  show('en');
  expect(screen.getByRole('button', { name: '€10' })).toHaveAttribute('aria-pressed', 'true');
  submit();
  expect(global.fetch).toHaveBeenCalledWith('/api/donate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amountCents: 1000, locale: 'en' }),
  });
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/abc'));
});

test.each([['€5', 500], ['€20', 2000]])('preset %s posts %i cents', async (label, cents) => {
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/abc' }) });
  show();
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
  submit();
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ amountCents: cents, locale: 'de' });
  await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
});

test.each(['0', '4', '4.5', '501', '5.0', '05'])('blocks invalid custom amount %s', (value) => {
  show();
  fireEvent.change(screen.getByLabelText('Anderer Betrag'), { target: { value } });
  expect(screen.getByRole('button', { name: 'Weiter zur sicheren Zahlung' })).toBeDisabled();
  submit();
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each([['5', 500], ['500', 50000]])('accepts custom whole EUR %s', async (value, cents) => {
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/abc' }) });
  show();
  fireEvent.change(screen.getByLabelText('Anderer Betrag'), { target: { value } });
  submit();
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ amountCents: cents, locale: 'de' });
  await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
});

test('disables checkout while pending and rejects synchronous duplicate submits', () => {
  global.fetch.mockImplementation(() => new Promise(() => {}));
  show();
  const button = screen.getByRole('button', { name: 'Weiter zur sicheren Zahlung' });
  fireEvent.submit(screen.getByRole('form', { name: 'Unterstützen' }));
  fireEvent.submit(screen.getByRole('form', { name: 'Unterstützen' }));
  expect(button).toBeDisabled();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('failed request shows a generic alert and permits retry', async () => {
  global.fetch.mockRejectedValueOnce(new Error('SECRET payment trace'))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/retry' }) });
  show();
  submit();
  expect(await screen.findByRole('alert')).not.toHaveTextContent('SECRET');
  expect(navigate).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Weiter zur sicheren Zahlung' })).toBeEnabled();
  submit();
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/retry'));
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test.each(['http://checkout.stripe.com/c/pay/abc', 'https://checkout.stripe.com.evil.test/c/pay/abc', 'https://evil.test/', 'https://checkout.stripe.com.evil.test@evil.test/', 'https://checkout.stripe.com/'])('rejects unsafe redirect %s', async (url) => {
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ url }) });
  show();
  submit();
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled();
});

test('close control and native dialog cancel both notify parent', () => {
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
  expect(onClose).toHaveBeenCalledTimes(2);
});

test('closing while checkout is pending prevents a late redirect', async () => {
  let finish;
  global.fetch.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const view = show();
  submit();
  fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
  view.unmount();
  await act(async () => finish({ ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/late' }) }));
  expect(navigate).not.toHaveBeenCalled();
});
