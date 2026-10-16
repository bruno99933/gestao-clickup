const crypto = require('crypto');

const EMAIL = process.env.LOGIN_EMAIL;
const PASSWORD = process.env.LOGIN_PASSWORD;
const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const COOKIE = 'sess';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

if (!EMAIL || !PASSWORD) console.warn('[auth] LOGIN_EMAIL/LOGIN_PASSWORD não configurados — login impossível');

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}

function issueCookie(res) {
  const exp = Date.now() + MAX_AGE_MS;
  const payload = Buffer.from(JSON.stringify({ e: EMAIL, exp })).toString('base64url');
  res.setHeader('Set-Cookie', `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_MS / 1000}`);
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
}

function check(req) {
  const raw = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='));
  if (!raw) return false;
  const [payload, sig] = decodeURIComponent(raw.slice(COOKIE.length + 1)).split('.');
  if (!payload || !sig || sig !== sign(payload)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.e === EMAIL && data.exp > Date.now();
  } catch { return false; }
}

function middleware(req, res, next) {
  req.authed = check(req);
  next();
}

function requireAuth(req, res, next) {
  if (req.authed) return next();
  if (req.method !== 'GET') return res.status(401).json({ error: 'não autenticado' });
  res.redirect('/login');
}

function validLogin(email, password) {
  return EMAIL && PASSWORD && email === EMAIL && password === PASSWORD;
}

module.exports = { middleware, requireAuth, validLogin, issueCookie, clearCookie };
