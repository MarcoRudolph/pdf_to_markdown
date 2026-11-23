const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createServer } = require('./server.cjs');

function listen(server) { return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port))); }
async function request(port, body, contentType = 'multipart/form-data; boundary=x') {
  const response = await fetch(`http://127.0.0.1:${port}/v1/convert`, { method: 'POST', headers: { 'content-type': contentType }, body });
  return { status: response.status, body: await response.text(), disposition: response.headers.get('content-disposition') };
}

test('proxy forwards body with server-only bearer, returns markdown, redacts failures and rejects oversize', async () => {
  let auth, seenBody, fail = false;
  const upstream = http.createServer((req, res) => {
    auth = req.headers.authorization;
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      seenBody = Buffer.concat(chunks).toString();
      res.writeHead(fail ? 500 : 200, { 'content-type': 'text/markdown', 'content-disposition': 'attachment; filename="document.md"' });
      res.end(fail ? 'INTERNAL SECRET' : '# Real text');
    });
  });
  const upstreamPort = await listen(upstream);
  const server = createServer({ token: 'private-only', apiUrl: `http://127.0.0.1:${upstreamPort}`, buildDir: __dirname, testMode: true });
  const port = await listen(server);
  try {
    let result = await request(port, 'PDF contents');
    assert.equal(result.status, 200);
    assert.equal(result.body, '# Real text');
    assert.equal(result.disposition, 'attachment; filename="document.md"');
    assert.equal(auth, 'Bearer private-only');
    assert.equal(seenBody, 'PDF contents');
    fail = true;
    result = await request(port, 'PDF contents');
    assert.equal(result.status, 502);
    assert.doesNotMatch(result.body, /SECRET/);
    result = await request(port, Buffer.alloc(10485760 + 65537));
    assert.equal(result.status, 413);
    result = await request(port, 'wrong', 'text/plain');
    assert.equal(result.status, 400);
  } finally { server.close(); upstream.close(); }
});

test('server refuses missing secret at startup', () => {
  assert.throws(() => createServer({ token: '', apiUrl: 'http://127.0.0.1:8000', buildDir: __dirname }), /API_TOKEN/);
});
