const { createHash, createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const { isIP } = require('node:net');

const COOKIE = 'pdf2md_id';
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;

function normalizeIp(value) {
  if (typeof value !== 'string' || !isIP(value)) return null;
  // URL canonicalizes compressed and expanded IPv6, including IPv4-mapped peers.
  const canonical = isIP(value) === 6 ? new URL(`http://[${value}]/`).hostname.slice(1, -1) : value;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(canonical);
  if (mapped && isIP(mapped[1]) === 4) return mapped[1];
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(canonical);
  if (hexMapped) {
    const bytes = [hexMapped[1], hexMapped[2]].flatMap(part => [parseInt(part, 16) >> 8, parseInt(part, 16) & 255]);
    return bytes.join('.');
  }
  return canonical.toLowerCase();
}

function clientIpFor(req, trustedProxyIp) {
  const peer = normalizeIp(req.socket.remoteAddress);
  if (!peer) throw new Error('trusted client IP unavailable');
  if (peer !== normalizeIp(trustedProxyIp)) return peer;
  const values = req.headersDistinct?.['cf-connecting-ip'];
  if (!Array.isArray(values) || values.length !== 1 || values[0].includes(',') || values[0] !== values[0].trim()) {
    throw new Error('trusted client IP unavailable');
  }
  const ip = normalizeIp(values[0]);
  if (!ip) throw new Error('trusted client IP unavailable');
  return ip;
}

function identityFor(req, res, { cookieSecret, trustedProxyIp }) {
  if (!cookieSecret) throw new Error('PAYGATE_COOKIE_SECRET required');
  // Validate the ingress before issuing a cookie or doing any quota work.
  const clientIp = clientIpFor(req, trustedProxyIp);
  const hmac = input => createHmac('sha256', cookieSecret).update(input).digest();
  const cookies = req.headersDistinct?.cookie || [];
  const matches = cookies.flatMap(header => header.split(';').map(part => part.trim()))
    .filter(part => part.startsWith(COOKIE + '='));
  let id;
  if (matches.length === 1) {
    const [candidate, signature, extra] = matches[0].slice(COOKIE.length + 1).split('.');
    if (extra === undefined && ID_PATTERN.test(candidate) && SIGNATURE_PATTERN.test(signature) &&
      Buffer.from(candidate, 'base64url').length === 16 &&
      timingSafeEqual(Buffer.from(signature, 'hex'), hmac(COOKIE + '|' + candidate))) id = candidate;
  }
  if (!id) {
    id = randomBytes(16).toString('base64url');
    res.setHeader('Set-Cookie', `${COOKIE}=${id}.${hmac(COOKIE + '|' + id).toString('hex')}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`);
  }
  res.setHeader('Cache-Control', 'no-store');
  return { subjectHash: createHash('sha256').update(id, 'utf8').digest('hex'), clientIp };
}

module.exports = { identityFor };
