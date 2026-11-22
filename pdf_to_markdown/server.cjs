// Same-origin, server-only upload bridge and static build host. No PDF body logging.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const MAX_REQUEST = 10485760 + 65536; // PDF limit plus multipart headers/boundary.
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ico': 'image/x-icon', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };

function createServer({ token, apiUrl, buildDir }) {
  if (!token) throw new Error('API_TOKEN must be set on the server');
  const upstream = new URL(apiUrl);
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password || upstream.pathname !== '/') throw new Error('Invalid API_URL');
  const client = upstream.protocol === 'https:' ? require('node:https') : http;
  return http.createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
    function reject(status, message) { if (!res.headersSent) { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }); res.end(message); } }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/v1/convert') {
      if (req.method !== 'POST') return reject(405, 'Method not allowed');
      if (!/^multipart\/form-data;\s*boundary=/.test(req.headers['content-type'] || '')) return reject(400, 'Expected PDF upload');
      if (Number(req.headers['content-length']) > MAX_REQUEST) {
        req.on('end', () => reject(413, 'PDF exceeds size limit'));
        req.resume(); // drain without buffering; avoid resetting a client still sending
        return;
      }
      let bytes = 0, stopped = false;
      const proxy = client.request(new URL('/v1/convert', upstream), { method: 'POST', headers: {
        'authorization': `Bearer ${token}`,
        'content-type': req.headers['content-type'],
        ...(req.headers['content-length'] ? { 'content-length': req.headers['content-length'] } : {}),
      } }, response => {
        if (stopped) return response.resume();
        const allowed = [200, 400, 401, 413, 422].includes(response.statusCode) ? response.statusCode : 502;
        if (allowed === 200) {
          res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': 'attachment; filename="document.md"' });
          response.pipe(res);
        } else {
          response.resume(); // never reflect upstream details to a user
          reject(allowed, allowed === 413 ? 'PDF exceeds size limit' : allowed === 422 ? 'PDF cannot be converted' : 'Conversion failed');
        }
      });
      proxy.setTimeout(60000, () => proxy.destroy());
      proxy.on('error', () => { if (!stopped) reject(502, 'Conversion unavailable'); });
      req.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_REQUEST && !stopped) {
          stopped = true;
          proxy.destroy();
          reject(413, 'PDF exceeds size limit');
          req.resume();
        } else if (!stopped && !proxy.write(chunk)) req.pause();
      });
      proxy.on('drain', () => req.resume());
      req.on('end', () => { if (!stopped) proxy.end(); });
      req.on('aborted', () => proxy.destroy());
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return reject(405, 'Method not allowed');
    const route = ['/', '/impressum', '/datenschutz'].includes(pathname) ? '/index.html' : pathname;
    let decoded;
    try { decoded = decodeURIComponent(route); } catch { return reject(400, 'Bad path'); }
    const root = path.resolve(buildDir);
    const file = path.resolve(root, '.' + decoded);
    if (!file.startsWith(root + path.sep)) return reject(404, 'Not found');
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) return reject(404, 'Not found');
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  });
}

if (require.main === module) {
  const server = createServer({ token: process.env.API_TOKEN, apiUrl: process.env.API_URL || 'http://127.0.0.1:8000', buildDir: path.join(__dirname, 'build') });
  server.listen(Number(process.env.PORT || 3001), process.env.HOST || '127.0.0.1', () => console.log('PDF frontend listening (no document logging)'));
}
module.exports = { createServer };
