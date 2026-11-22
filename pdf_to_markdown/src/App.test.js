import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

const pdf = (name = 'probe.pdf', size = 20, type = 'application/pdf') => new File([new Uint8Array(size)], name, { type });
const choose = (file) => fireEvent.change(screen.getByLabelText('to File'), { target: { files: [file] } });

beforeEach(() => {
  global.XMLHttpRequest = jest.fn();
  global.fetch = jest.fn();
  delete process.env.REACT_APP_DONATIONS_ENABLED;
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  delete process.env.REACT_APP_DONATIONS_ENABLED;
  delete global.fetch;
  window.history.replaceState(null, '', '/');
  jest.restoreAllMocks();
});

test('shows the landing page, legal links and a non-operational donation control', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /ihre pdf.*markdown/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /donate.*demnächst verfügbar/i })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'Impressum' })).toHaveAttribute('href', '/impressum');
  expect(screen.getByRole('link', { name: 'Datenschutzerklärung' })).toHaveAttribute('href', '/datenschutz');
  expect(screen.getByRole('link', { name: /quellcode/i })).toHaveAttribute('href', 'https://github.com/MarcoRudolph/pdf_to_markdown');
  expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('enabled Donate opens a native dialog and closing restores trigger focus', () => {
  process.env.REACT_APP_DONATIONS_ENABLED = '1';
  const showModal = HTMLDialogElement.prototype.showModal;
  const close = HTMLDialogElement.prototype.close;
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  try {
    render(<App />);
    const donate = screen.getByRole('button', { name: 'Donate' });
    expect(donate).toBeEnabled();
    expect(screen.queryByText('Demnächst verfügbar')).not.toBeInTheDocument();
    fireEvent.click(donate);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /schließen|close/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(donate).toHaveFocus();
    expect(global.fetch).not.toHaveBeenCalled();
  } finally {
    HTMLDialogElement.prototype.showModal = showModal;
    HTMLDialogElement.prototype.close = close;
  }
});

test('outside the German region the enabled modal uses English', () => {
  process.env.REACT_APP_DONATIONS_ENABLED = '1';
  const language = jest.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-US', 'de-DE']);
  const showModal = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  try {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Donate' }));
    expect(screen.getByRole('dialog', { name: 'Support' })).toBeInTheDocument();
  } finally {
    language.mockRestore();
    HTMLDialogElement.prototype.showModal = showModal;
  }
});

test('canceled checkout is neutral and does not request payment status', () => {
  window.history.replaceState(null, '', '/?donation=cancel');
  render(<App />);
  expect(screen.getByRole('status')).toHaveTextContent(/abgebrochen/i);
  expect(screen.getByRole('status')).not.toHaveTextContent(/vielen dank/i);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('success return missing a session ID never thanks or fetches', () => {
  window.history.replaceState(null, '', '/?donation=success');
  render(<App />);
  expect(screen.getByRole('alert')).toHaveTextContent(/nicht verifizier|nicht verfügbar/i);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(screen.queryByText(/vielen dank für ihre unterstützung/i)).not.toBeInTheDocument();
});

test.each([
  ['processing', /bestätigung|bearbeitung/i, 'status'],
  ['incomplete', /nicht abgeschlossen/i, 'status'],
  ['expired', /abgelaufen/i, 'status'],
  ['paid', /vielen dank für ihre unterstützung/i, 'status'],
])('verified %s checkout displays only the corresponding message and removes the session ID', async (status, message, role) => {
  process.env.REACT_APP_DONATIONS_ENABLED = '1';
  window.history.replaceState(null, '', '/?donation=success&session_id=cs_test_dummy');
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ status }) });
  render(<App />);
  await waitFor(() => expect(screen.getByRole(role)).toHaveTextContent(message));
  expect(global.fetch).toHaveBeenCalledWith('/api/donate/status?session_id=cs_test_dummy', expect.objectContaining({ signal: expect.any(Object) }));
  expect(window.location.pathname + window.location.search).toBe('/');
  if (status !== 'paid') expect(screen.getByRole(role)).not.toHaveTextContent(/vielen dank/i);
});

test('status network error shows unavailable, hides identifier and never thanks', async () => {
  window.history.replaceState(null, '', '/?donation=success&session_id=cs_test_dummy');
  global.fetch.mockRejectedValue(new Error('sensitive provider response'));
  render(<App />);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/nicht verfügbar/i));
  expect(screen.getByRole('alert')).not.toHaveTextContent(/sensitive|vielen dank/i);
  expect(window.location.pathname + window.location.search).toBe('/');
});

test('privacy page identifies Stripe separately and links its privacy notice', () => {
  window.history.replaceState(null, '', '/datenschutz');
  render(<App />);
  expect(screen.getByRole('main')).toHaveTextContent(/stripe/i);
  expect(screen.getByRole('main')).toHaveTextContent(/kartendaten.*nicht.*pdf.proxy/i);
  expect(screen.getByRole('link', { name: /stripe.*datenschutz/i })).toHaveAttribute('href', expect.stringMatching(/^https:\/\/stripe\.com\//));
  expect(document.querySelector('script[src*="stripe"]')).toBeNull();
});

test('rejects non PDF and oversized file before any network request', () => {
  render(<App />);
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
