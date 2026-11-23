// Strict, bounded inbound multipart parser; never forward user-supplied part metadata.
const Busboy = require('busboy');
const LIMIT = 10485760;
const MAX_REQUEST = LIMIT + 65536;
const UPLOAD_BODY_TIMEOUT_MS = 60000; // Total body time, not an idle timeout; allows 10 MiB at ~170 KiB/s.

function parsePdf(req, timeoutMs = UPLOAD_BODY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let parser;
    try { parser = Busboy({ headers: req.headers, limits: { files: 1, fileSize: LIMIT, fields: 0, parts: 1 } }); }
    catch { reject({ status: 400 }); return; }
    const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(req.headers['content-type']);
    if (!match) { reject({ status: 400 }); return; }
    // Busboy emits partsLimit on the first permitted part and ignores later
    // parts/trailing data. Scan the raw stream for exactly one *final* closing
    // delimiter, including across socket chunks, before accepting its output.
    const delimiter = Buffer.from(`\r\n--${match[1] || match[2]}`);
    let delimiterOffset = 0, state = 'body', closes = 0;
    let position = 0, headerOffset = 0, fileStart = null, closingStart = null;
    const headerEnd = Buffer.from('\r\n\r\n');
    let bytes = 0, fileCount = 0, fileBytes = 0;
    let invalid = false, tooLarge = false, completed = false, requestEnded = false, parserClosed = false;
    let fileBuffer;
    const deadline = setTimeout(() => fail(408), timeoutMs);
    const cleanup = () => {
      clearTimeout(deadline);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('aborted', onAbort);
    };
    const fail = status => {
      if (completed) return;
      completed = true;
      cleanup();
      req.unpipe(parser);
      parser.destroy();
      req.resume();
      reject({ status });
    };
    const finish = () => {
      if (completed || !requestEnded || !parserClosed) return;
      completed = true;
      cleanup();
      const actualFileBytes = closingStart === null || fileStart === null ? null : closingStart - fileStart;
      if (tooLarge || actualFileBytes > LIMIT) reject({ status: 413 });
      else if (invalid || fileCount !== 1 || closes !== 1 || actualFileBytes === null ||
        actualFileBytes !== fileBytes || !['closed', 'closedCRLF'].includes(state)) reject({ status: 400 });
      else resolve(fileBuffer.subarray(0, fileBytes));
    };
    function scan(chunk) {
      for (const byte of chunk) {
        if (fileStart === null) {
          if (byte === headerEnd[headerOffset]) headerOffset++;
          else headerOffset = byte === headerEnd[0] ? 1 : 0;
          if (headerOffset === headerEnd.length) fileStart = position + 1;
        }
        if (state === 'closed') { if (byte === 13) state = 'closedCR'; else invalid = true; }
        else if (state === 'closedCR') { if (byte === 10) state = 'closedCRLF'; else invalid = true; }
        else if (state === 'closedCRLF' || state === 'invalid') invalid = true;
        else if (state === 'openingLF') { invalid = true; state = 'invalid'; }
        else if (state === 'closingDash') {
          if (byte === 45) { closes++; state = 'closed'; }
          else { invalid = true; state = 'invalid'; }
        } else if (state === 'afterDelimiter') {
          if (byte === 13) state = 'openingLF';
          else if (byte === 45) state = 'closingDash';
          else { invalid = true; state = 'invalid'; } // Busboy treats prefix lookalikes as boundaries.
        } else {
          if (byte === delimiter[delimiterOffset]) delimiterOffset++;
          else delimiterOffset = byte === delimiter[0] ? 1 : 0;
          if (delimiterOffset === delimiter.length) {
            closingStart = position - delimiter.length + 1;
            state = 'afterDelimiter'; delimiterOffset = 0;
          }
        }
        position++;
      }
    }
    function onData(chunk) {
      bytes += chunk.length;
      if (bytes > MAX_REQUEST) { fail(413); return; }
      scan(chunk);
    }
    req.on('data', onData);
    parser.on('file', (name, stream) => {
      fileCount++;
      if (name !== 'file' || fileCount > 1) invalid = true;
      // At most one 10 MiB backing allocation per admitted upload; subarray
      // shares it with outbound writes instead of copying all PDF bytes again.
      if (!invalid) fileBuffer = Buffer.allocUnsafe(LIMIT);
      stream.on('data', chunk => {
        if (invalid || tooLarge) return;
        if (fileBytes + chunk.length > LIMIT) { tooLarge = true; return; }
        chunk.copy(fileBuffer, fileBytes);
        fileBytes += chunk.length;
      });
      stream.on('limit', () => { /* emitted at exactly LIMIT too; measured framing decides 413 */ });
      stream.on('error', () => fail(400));
    });
    parser.on('field', () => { invalid = true; });
    parser.on('filesLimit', () => { invalid = true; });
    parser.on('fieldsLimit', () => { invalid = true; });
    parser.on('partsLimit', () => { /* fired for the first part; raw scanner rejects extras */ });
    parser.on('error', () => fail(400));
    parser.on('close', () => { parserClosed = true; finish(); });
    function onEnd() { requestEnded = true; finish(); }
    function onAbort() { fail(400); }
    req.on('end', onEnd);
    req.on('aborted', onAbort);
    req.pipe(parser);
  });
}
module.exports = { parsePdf, LIMIT, MAX_REQUEST, UPLOAD_BODY_TIMEOUT_MS };
