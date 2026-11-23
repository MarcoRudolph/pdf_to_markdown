// Strict, bounded inbound multipart parser; never forward user-supplied part metadata.
const Busboy = require('busboy');
const LIMIT = 10485760;
const MAX_REQUEST = LIMIT + 65536;
function parsePdf(req) {
  return new Promise((resolve, reject) => {
    let parser;
    try { parser = Busboy({ headers: req.headers, limits: { files: 1, fileSize: LIMIT, fields: 0, parts: 1 } }); }
    catch { reject({ status: 400 }); return; }
    let bytes = 0, fileCount = 0, invalid = false, tooLarge = false, completed = false;
    const chunks = [];
    // Busboy emits partsLimit even for the first permitted part. Detect another
    // opening delimiter in the bounded stream while Busboy ignores extra parts.
    const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(req.headers['content-type']);
    const extraDelimiter = Buffer.from(`\r\n--${match?.[1] || match?.[2]}\r\n`);
    let delimiterTail = Buffer.alloc(0);
    const fail = status => {
      if (completed) return;
      completed = true;
      req.unpipe(parser);
      req.resume();
      reject({ status });
    };
    req.on('data', chunk => {
      bytes += chunk.length;
      const window = Buffer.concat([delimiterTail, chunk]);
      if (window.includes(extraDelimiter)) invalid = true;
      delimiterTail = window.subarray(Math.max(0, window.length - extraDelimiter.length + 1));
      if (bytes > MAX_REQUEST) fail(413);
    });
    parser.on('file', (name, stream) => {
      fileCount++;
      if (name !== 'file' || fileCount > 1) invalid = true;
      stream.on('data', chunk => { if (!invalid && !tooLarge) chunks.push(chunk); });
      stream.on('limit', () => { tooLarge = true; });
      stream.on('error', () => fail(400));
    });
    parser.on('field', () => { invalid = true; });
    parser.on('filesLimit', () => { invalid = true; });
    parser.on('fieldsLimit', () => { invalid = true; });
    parser.on('partsLimit', () => { /* fires at the first part; delimiter scan rejects any subsequent part */ });
    parser.on('error', () => fail(400));
    parser.on('close', () => {
      if (completed) return;
      completed = true;
      if (tooLarge) reject({ status: 413 });
      else if (invalid || fileCount !== 1) reject({ status: 400 });
      else resolve(Buffer.concat(chunks));
    });
    req.on('aborted', () => fail(400));
    req.pipe(parser);
  });
}
module.exports = { parsePdf, LIMIT, MAX_REQUEST };
