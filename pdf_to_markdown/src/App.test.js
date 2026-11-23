import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

const pdf = (name = 'probe.pdf', size = 20, type = 'application/pdf') => new File([new Uint8Array(size)], name, { type });
const choose = (file) => fireEvent.change(screen.getByLabelText('to File'), { target: { files: [file] } });

const quota = (free = 5, paid = []) => ({ free: { units_left: free, limits: { max_file_bytes: 1048576 } }, paid });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const xhrFixture = () => {
  const requests = [];
  global.XMLHttpRequest.mockImplementation(() => {
    const xhr = { upload: {}, open: jest.fn(), send: jest.fn(), abort: jest.fn(), status: 402 };
    requests.push(xhr);
    return xhr;
  });
  return requests;
};
beforeEach(() => {
  global.XMLHttpRequest = jest.fn();
  global.fetch = jest.fn(async () => response(quota()));
  window.history.replaceState({}, '', '/');
});
afterEach(() => { jest.useRealTimers(); });

test('displays server-provided free and paid file limits, not hardcoded plan limits', async () => {
  global.fetch.mockResolvedValue(response({
    free: { units_left: 2, limits: { max_file_bytes: 2 * 1048576 } },
    paid: [{ units_left: 7, limits: { max_file_bytes: 8 * 1048576 } }],
  }));
  render(<App />);
  expect(await screen.findByText(/2 MiB frei.*8 MiB mit Pass/i)).toBeInTheDocument();
  expect(screen.queryByText(/1 MiB frei.*10 MiB mit Pass/i)).not.toBeInTheDocument();
});

test('without an active pass the quota does not present the offer size as a current paid limit', async () => {
  render(<App />);
  expect(await screen.findByText(/5 PDFs frei/i)).toBeInTheDocument();
  expect(screen.getByText(/1 MiB frei.*kein aktiver Pass/i)).toBeInTheDocument();
  expect(screen.queryByText(/10 MiB mit Pass/i)).not.toBeInTheDocument();
});

test('shows server free balance and sum of active paid passes with distinct file limits and fixed offer', async () => {
  global.fetch.mockResolvedValue(response(quota(2, [{ units_left: 17, limits: { max_file_bytes: 10485760 } }, { units_left: 31, limits: { max_file_bytes: 10485760 } }])));
  render(<App />);
  expect(await screen.findByText(/2 PDFs frei/i)).toBeInTheDocument();
  expect(screen.getByText(/48 PDFs mit Pass/i)).toBeInTheDocument();
  expect(screen.getByText(/1 MiB frei.*10 MiB mit Pass/i)).toBeInTheDocument();
  expect(screen.getByText(/2 € \/ 50 PDFs pro Tag \/ 30 Tage/i)).toBeInTheDocument();
});

test('402 offers checkout rather than generic retry and navigates only to server checkout URL', async () => {
  const requests = xhrFixture();
  global.fetch.mockImplementation(async url => url === '/v1/checkout' ? response({ url: 'https://checkout.stripe.com/c/pay' }) : response(quota(0)));
  const navigate = jest.fn();
  render(<App navigate={navigate} />);
  choose(pdf());
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  act(() => requests[0].onload());
  expect(await screen.findByText(/Pass benötigt/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Erneut versuchen' })).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: /Pass kaufen/i })[1]);
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay'));
  expect(global.fetch).toHaveBeenCalledWith('/v1/checkout', expect.objectContaining({ method: 'POST', body: '{}' }));
});

test.each([
  'javascript:alert(1)',
  'https://checkout.stripe.com.evil.example/c/pay',
  '/relative-checkout',
  'https://attacker.example/checkout',
  'https://user:secret@checkout.stripe.com/c/pay',
  'https://checkout.stripe.com:444/c/pay',
  null,
])('checkout refuses unsafe or malformed destination %p', async destination => {
  global.fetch.mockImplementation(async url => url === '/v1/checkout' ? response({ url: destination }) : response(quota()));
  const navigate = jest.fn();
  render(<App navigate={navigate} />);
  fireEvent.click(screen.getByRole('button', { name: 'Pass kaufen' }));
  expect(await screen.findByText(/Checkout derzeit nicht verfügbar/i)).toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled();
});

test('privacy draft does not claim the restore code is shown only once', () => {
  window.history.replaceState({}, '', '/datenschutz');
  render(<App />);
  expect(screen.getByText(/bei bestätigter Zahlung.*erneut abrufbar/i)).toBeInTheDocument();
  expect(screen.queryByText(/im Browser einmal angezeigt/i)).not.toBeInTheDocument();
});

test('a never-settling status fetch times out, aborts, scrubs URL and enables retry', async () => {
  jest.useFakeTimers();
  window.history.replaceState({}, '', '/?session_id=cs_stalled&keep=1');
  let statusSignal;
  global.fetch.mockImplementation((url, options) => {
    if (url.startsWith('/v1/checkout-status')) {
      statusSignal = options.signal;
      return new Promise(() => {}); // Deliberately ignores AbortSignal.
    }
    return Promise.resolve(response(quota()));
  });
  const timerSpy = jest.spyOn(global, 'setTimeout');
  const clearSpy = jest.spyOn(global, 'clearTimeout');
  render(<App />);
  expect(screen.getByText(/Zahlung wird geprüft/i)).toBeInTheDocument();
  expect(statusSignal).toBeDefined();
  await act(async () => { jest.advanceTimersByTime(5000); await Promise.resolve(); });
  expect(statusSignal.aborted).toBe(true);
  expect(clearSpy).toHaveBeenCalledWith(timerSpy.mock.results[0].value);
  clearSpy.mockRestore();
  timerSpy.mockRestore();
  expect(screen.getByText(/Zahlungsstatus.*nicht verfügbar/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Zahlungsstatus erneut prüfen/i })).toBeInTheDocument();
  expect(screen.queryByText(/Wiederherstellungscode:/i)).not.toBeInTheDocument();
  expect(window.location.search).toBe('?keep=1');
});

test('abort-aware fetch still reports a retryable status timeout, not a raw AbortError', async () => {
  jest.useFakeTimers();
  window.history.replaceState({}, '', '/?session_id=cs_abortaware');
  global.fetch.mockImplementation((url, options) => url.startsWith('/v1/checkout-status')
    ? new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
    : Promise.resolve(response(quota())));
  render(<App />);
  await act(async () => { jest.advanceTimersByTime(5000); await Promise.resolve(); });
  expect(screen.getByText(/Zahlungsstatus derzeit nicht verfügbar/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Zahlungsstatus erneut prüfen/i })).toBeInTheDocument();
  expect(window.location.search).toBe('');
});

test('unmount aborts an in-flight status fetch and clears its timeout', async () => {
  jest.useFakeTimers();
  window.history.replaceState({}, '', '/?session_id=cs_unmount');
  let statusSignal;
  global.fetch.mockImplementation((url, options) => {
    if (url.startsWith('/v1/checkout-status')) {
      statusSignal = options.signal;
      return new Promise(() => {});
    }
    return Promise.resolve(response(quota()));
  });
  const timerSpy = jest.spyOn(global, 'setTimeout');
  const clearSpy = jest.spyOn(global, 'clearTimeout');
  const view = render(<App />);
  expect(statusSignal).toBeDefined();
  await act(async () => { view.unmount(); await Promise.resolve(); });
  expect(statusSignal.aborted).toBe(true);
  expect(clearSpy).toHaveBeenCalledWith(timerSpy.mock.results[0].value);
  clearSpy.mockRestore();
  timerSpy.mockRestore();
});

test('status body read timeout aborts, exposes retry, scrubs URL and ignores a late ready body', async () => {
  jest.useFakeTimers();
  window.history.replaceState({}, '', '/?session_id=cs_body_stalled&keep=1');
  let statusSignal;
  let finishBody;
  const body = new Promise(resolve => { finishBody = resolve; });
  global.fetch.mockImplementation((url, options) => url.startsWith('/v1/checkout-status')
    ? (statusSignal = options.signal, Promise.resolve({ ok: true, json: () => body }))
    : Promise.resolve(response(quota())));
  render(<App />);
  await act(async () => { await Promise.resolve(); });
  expect(statusSignal).toBeDefined();
  expect(screen.getByText(/Zahlung wird geprüft/i)).toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(5000); await Promise.resolve(); });
  expect(statusSignal.aborted).toBe(true);
  expect(screen.getByText(/Zahlungsstatus derzeit nicht verfügbar/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Zahlungsstatus erneut prüfen/i })).toBeInTheDocument();
  expect(window.location.search).toBe('?keep=1');
  await act(async () => { finishBody({ status: 'ready', restore_code: 'LATE-CODE' }); await Promise.resolve(); });
  expect(screen.queryByText('LATE-CODE')).not.toBeInTheDocument();
  expect(global.fetch.mock.calls.filter(([url]) => url.startsWith('/v1/checkout-status'))).toHaveLength(1);
});

test('unmount during status body read aborts and clears request deadline', async () => {
  jest.useFakeTimers();
  window.history.replaceState({}, '', '/?session_id=cs_body_unmount');
  let statusSignal;
  global.fetch.mockImplementation((url, options) => url.startsWith('/v1/checkout-status')
    ? (statusSignal = options.signal, Promise.resolve({ ok: true, json: () => new Promise(() => {}) }))
    : Promise.resolve(response(quota())));
  const timerSpy = jest.spyOn(global, 'setTimeout');
  const clearSpy = jest.spyOn(global, 'clearTimeout');
  const view = render(<App />);
  await act(async () => { await Promise.resolve(); });
  expect(statusSignal).toBeDefined();
  await act(async () => { view.unmount(); await Promise.resolve(); });
  expect(statusSignal.aborted).toBe(true);
  expect(clearSpy).toHaveBeenCalledWith(timerSpy.mock.results[0].value);
  clearSpy.mockRestore();
  timerSpy.mockRestore();
});

test('pending checkout never exposes restore code; bounded polling scrubs URL on exhaustion', async () => {
  window.history.replaceState({}, '', '/?session_id=cs_pending');
  global.fetch.mockImplementation(async url => response(url.startsWith('/v1/checkout-status') ? { status: 'pending' } : quota()));
  render(<App />);
  expect(await screen.findByText(/Zahlung wird geprüft/i)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText(/noch nicht bestätigt/i)).toBeInTheDocument(), { timeout: 15000 });
  expect(screen.queryByText(/Wiederherstellungscode:/i)).not.toBeInTheDocument();
  expect(window.location.search).toBe('');
  expect(global.fetch.mock.calls.filter(([url]) => url.startsWith('/v1/checkout-status')).length).toBeLessThanOrEqual(5);
}, 20000);

test('ready checkout reveals restore code only after verification and removes session URL', async () => {
  window.history.replaceState({}, '', '/?session_id=cs_ready&keep=1');
  global.fetch.mockImplementation(async url => response(url.startsWith('/v1/checkout-status') ? { status: 'ready', restore_code: 'CODE-SECRET' } : quota()));
  render(<App />);
  expect(await screen.findByText('CODE-SECRET')).toBeInTheDocument();
  expect(screen.getAllByText(/sicher aufbewahren/i).length).toBeGreaterThan(0);
  expect(window.location.search).toBe('?keep=1');
});

test('redeeming a code refreshes quota and does not claim success for invalid codes', async () => {
  let free = 0;
  global.fetch.mockImplementation(async url => {
    if (url === '/v1/redeem') { free = 3; return response({ passes: 1 }); }
    return response(quota(free, free ? [{ units_left: 50 }] : []));
  });
  render(<App />);
  expect(await screen.findByText(/0 PDFs frei/i)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Wiederherstellungscode eingeben/i), { target: { value: 'my-code' } });
  fireEvent.click(screen.getByRole('button', { name: /Pass wiederherstellen/i }));
  expect(await screen.findByText(/50 PDFs mit Pass/i)).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith('/v1/redeem', expect.objectContaining({ method: 'POST', body: JSON.stringify({ code: 'my-code' }) }));
});

test('quota 503 and checkout-status 503 are honest and do not reveal a code', async () => {
  window.history.replaceState({}, '', '/?session_id=cs_unavailable');
  global.fetch.mockResolvedValue(response({}, 503));
  render(<App />);
  expect(await screen.findByText(/Kontingent derzeit nicht verfügbar/i)).toBeInTheDocument();
  expect(await screen.findByText(/Zahlungsstatus.*nicht verfügbar/i)).toBeInTheDocument();
  expect(window.location.search).toBe('');
});

test('503 checkout status offers a manual retry without claiming payment', async () => {
  window.history.replaceState({}, '', '/?session_id=cs_retry');
  let available = false;
  global.fetch.mockImplementation(async url => url.startsWith('/v1/checkout-status') ? (available ? response({ status: 'ready', restore_code: 'RETRY-CODE' }) : response({}, 503)) : response(quota()));
  render(<App />);
  expect(await screen.findByText(/Zahlungsstatus.*nicht verfügbar/i)).toBeInTheDocument();
  expect(screen.queryByText('RETRY-CODE')).not.toBeInTheDocument();
  available = true;
  fireEvent.click(screen.getByRole('button', { name: /Zahlungsstatus erneut prüfen/i }));
  expect(await screen.findByText('RETRY-CODE')).toBeInTheDocument();
  expect(window.location.search).toBe('');
});

test('exactly 1 MiB and exactly 10 MiB are selectable; above 10 MiB rejected', async () => {
  render(<App />);
  await screen.findByText(/5 PDFs frei/i);
  choose(pdf('free.pdf', 1048576));
  expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled();
  choose(pdf('paid.pdf', 10485760));
  expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled();
  choose(pdf('too-large.pdf', 10485761));
  expect(screen.getByRole('alert')).toHaveTextContent(/10 MiB/);
  expect(screen.getAllByText(/100 Seiten/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/keine OCR/i).length).toBeGreaterThan(0);
});

test('shows the landing page, legal links and a pass offer without a misleading donation control', async () => {
  render(<App />);
  await screen.findByText(/5 PDFs frei/i);
  expect(screen.getByRole('heading', { name: /ihre pdf.*markdown/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /donate/i })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Pass kaufen' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Impressum' })).toHaveAttribute('href', '/impressum');
  expect(screen.getByRole('link', { name: 'Datenschutzerklärung' })).toHaveAttribute('href', '/datenschutz');
  expect(screen.getByRole('link', { name: /quellcode/i })).toHaveAttribute('href', 'https://github.com/MarcoRudolph/pdf_to_markdown');
  expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
});

test('rejects non PDF and oversized file before any network request', async () => {
  render(<App />);
  await screen.findByText(/5 PDFs frei/i);
  choose(pdf('evil.txt', 10, 'text/plain'));
  expect(screen.getByRole('alert')).toHaveTextContent(/pdf/i);
  choose(pdf('large.pdf', 10485761));
  expect(screen.getByRole('alert')).toHaveTextContent(/10 MiB/i);
  expect(global.XMLHttpRequest).not.toHaveBeenCalled();
});

test('uploads once, shows measured progress, downloads document.md and can choose a new PDF', async () => {
  let xhr;
  global.XMLHttpRequest.mockImplementation(() => {
    xhr = { upload: {}, open: jest.fn(), send: jest.fn(), abort: jest.fn(), setRequestHeader: jest.fn(), status: 200, responseText: '# Hallo' };
    return xhr;
  });
  global.URL.createObjectURL = jest.fn(() => 'blob:markdown');
  global.URL.revokeObjectURL = jest.fn();
  render(<App />);
  choose(pdf());
  expect(screen.getByText('probe.pdf')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  fireEvent.click(screen.getByRole('button', { name: /wird hochgeladen/i }));
  expect(xhr.send).toHaveBeenCalledTimes(1);
  expect(xhr.open).toHaveBeenCalledWith('POST', '/v1/convert');
  act(() => xhr.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 }));
  expect(screen.getByText(/50 %/)).toBeInTheDocument();
  act(() => xhr.upload.onload());
  expect(screen.getByText(/verarbeitet/i)).toBeInTheDocument();
  act(() => xhr.onload());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument());
  expect(screen.getByText('Vielen Dank, dass Sie PDF to Markdown genutzt haben. Empfehlen Sie uns weiter!')).toBeInTheDocument();
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = jest.fn();
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  HTMLAnchorElement.prototype.click = originalClick;
  choose(pdf('again.pdf'));
  expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled();
  expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:markdown');
});

test('redacts API errors and retries with the same file', async () => {
  const requests = [];
  global.XMLHttpRequest.mockImplementation(() => {
    const xhr = { upload: {}, open: jest.fn(), send: jest.fn(), abort: jest.fn(), setRequestHeader: jest.fn(), status: 500, responseText: 'SECRET INTERNAL TRACE' };
    requests.push(xhr);
    return xhr;
  });
  render(<App />);
  choose(pdf());
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  act(() => requests[0].onload());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument());
  expect(screen.getByRole('alert')).not.toHaveTextContent(/SECRET/);
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
  expect(requests).toHaveLength(2);
});

describe('voluntary donation', () => {
  const donationCalls = () => global.fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/donate'));
  const passStatusCalls = () => global.fetch.mock.calls.filter(([url]) => String(url).startsWith('/v1/checkout-status'));
  afterEach(() => { delete process.env.REACT_APP_DONATIONS_ENABLED; });

  test('enabled Donate opens a native dialog and closing restores trigger focus', async () => {
    process.env.REACT_APP_DONATIONS_ENABLED = '1';
    render(<App />);
    const donate = screen.getByRole('button', { name: 'Donate' });
    fireEvent.click(donate);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /schließen|close/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(donate).toHaveFocus();
    expect(donationCalls()).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'PDF-Pass ansehen' })).toBeInTheDocument();
    await screen.findByText(/5 PDFs frei/i);
  });

  test('outside the German region the enabled modal uses English', async () => {
    process.env.REACT_APP_DONATIONS_ENABLED = '1';
    const languages = jest.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-US', 'de-DE']);
    try {
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: 'Donate' }));
      expect(screen.getByRole('dialog', { name: 'Support' })).toBeInTheDocument();
      await screen.findByText(/5 PDFs frei/i);
    } finally { languages.mockRestore(); }
  });

  test('canceled checkout is neutral, scrubbed, and does not request any payment status', async () => {
    window.history.replaceState(null, '', '/?donation=cancel');
    render(<App />);
    expect(screen.getByText(/abgebrochen/i)).toBeInTheDocument();
    expect(screen.queryByText(/vielen dank/i)).not.toBeInTheDocument();
    await screen.findByText(/5 PDFs frei/i);
    expect(donationCalls()).toHaveLength(0);
    expect(passStatusCalls()).toHaveLength(0);
    expect(window.location.search).toBe('');
  });

  test('success return missing a session ID never thanks or fetches status', async () => {
    window.history.replaceState(null, '', '/?donation=success');
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent(/nicht verifizier|nicht verfügbar/i);
    await screen.findByText(/5 PDFs frei/i);
    expect(donationCalls()).toHaveLength(0);
    expect(screen.queryByText(/vielen dank für ihre unterstützung/i)).not.toBeInTheDocument();
  });

  test.each([
    ['processing', /bestätigung/i],
    ['incomplete', /nicht abgeschlossen/i],
    ['expired', /abgelaufen/i],
    ['paid', /vielen dank für ihre unterstützung/i],
  ])('verified %s donation shows only its message, removes the session ID and never runs the pass status flow', async (status, message) => {
    window.history.replaceState(null, '', '/?donation=success&session_id=cs_test_dummy');
    global.fetch.mockImplementation(async url => String(url).startsWith('/api/donate/status') ? response({ status }) : response(quota()));
    render(<App />);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith('/api/donate/status?session_id=cs_test_dummy', expect.objectContaining({ signal: expect.any(Object) }));
    expect(passStatusCalls()).toHaveLength(0);
    expect(screen.queryByText(/Zahlung wird geprüft/i)).not.toBeInTheDocument();
    expect(window.location.pathname + window.location.search).toBe('/');
    if (status !== 'paid') expect(screen.queryByText(/vielen dank/i)).not.toBeInTheDocument();
  });

  test('status network error shows unavailable, hides identifier and never thanks', async () => {
    window.history.replaceState(null, '', '/?donation=success&session_id=cs_test_dummy');
    global.fetch.mockImplementation(async url => { if (String(url).startsWith('/api/donate')) throw new Error('sensitive provider response'); return response(quota()); });
    render(<App />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/nicht verfügbar/i));
    expect(screen.getByRole('alert')).not.toHaveTextContent(/sensitive|vielen dank/i);
    expect(window.location.pathname + window.location.search).toBe('/');
  });

  test('privacy page describes donations via Stripe and links its privacy notice', () => {
    window.history.replaceState(null, '', '/datenschutz');
    render(<App />);
    expect(screen.getByRole('main')).toHaveTextContent(/kartendaten.*nicht.*pdf.proxy/i);
    expect(screen.getByRole('main')).toHaveTextContent(/Unterstützung schaltet kein Kontingent frei/i);
    expect(screen.getByRole('link', { name: /stripe.*datenschutz/i })).toHaveAttribute('href', expect.stringMatching(/^https:\/\/stripe\.com\//));
    expect(document.querySelector('script[src*="stripe"]')).toBeNull();
  });
});
