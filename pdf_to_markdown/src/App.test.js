import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

const pdf = (name = 'probe.pdf', size = 20, type = 'application/pdf') => new File([new Uint8Array(size)], name, { type });
const choose = (file) => fireEvent.change(screen.getByLabelText('to File'), { target: { files: [file] } });

beforeEach(() => { global.XMLHttpRequest = jest.fn(); });

test('shows the landing page, legal links and a non-operational donation control', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /ihre pdf.*markdown/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /donate.*demnächst verfügbar/i })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'Impressum' })).toHaveAttribute('href', '/impressum');
  expect(screen.getByRole('link', { name: 'Datenschutzerklärung' })).toHaveAttribute('href', '/datenschutz');
  expect(screen.getByRole('link', { name: /quellcode/i })).toHaveAttribute('href', 'https://github.com/MarcoRudolph/pdf_to_markdown');
  expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
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
