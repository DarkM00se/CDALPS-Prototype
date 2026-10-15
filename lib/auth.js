'use strict';
const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const SESSION_MS = 30 * 60 * 1000;

function createAuth(store, options = {}) {
  const { audit } = store;
  const credentials = {};
  const users = new Map();
  for (const { username, role } of store.users) {
    const password = options.passwords?.[role] || process.env[`DEMO_${role.toUpperCase()}_PASSWORD`] || randomBytes(15).toString('base64url');
    if (password.length < 12 || password.length > 256) throw new Error('Demo passwords must have 12–256 characters.');
    credentials[username] = password;
    const salt = randomBytes(16);
    users.set(username, { role, salt, hash: scryptSync(password, salt, 64) });
  }
  const dummySalt = randomBytes(16);
  const dummyHash = scryptSync(randomBytes(20), dummySalt, 64);
  const sessions = new Map();
  const attempts = new Map();

  function expire() {
    const now = Date.now();
    for (const [id, session] of sessions) if (session.expires <= now) sessions.delete(id);
    for (const [ip, attempt] of attempts) if (attempt.until <= now) attempts.delete(ip);
    for (const [id, request] of store.requests) if (request.expires <= now) store.requests.delete(id);
  }

  function install(app) {
  app.post('/api/login', (req, res) => {
    const ip = req.socket.remoteAddress;
    const count = attempts.get(ip) || { count: 0, until: Date.now() + 60000 };
    if (count.count >= 10) return res.status(429).json({ error: 'Too many attempts. Wait one minute.' });
    count.count++;
    attempts.set(ip, count);
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || password.length > 256) return res.status(400).json({ error: 'Invalid login input.' });
    const user = users.get(username);
    const hash = scryptSync(password, user?.salt || dummySalt, 64);
    if (!timingSafeEqual(hash, user?.hash || dummyHash) || !user) {
      audit('anonymous', 'login', 'deny');
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    // Rotate the session if this browser was already signed in.
    const old = (req.headers.cookie || '').match(/(?:^|;\s*)demo_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (old) sessions.delete(old);
    if (sessions.size >= 100) return res.status(503).json({ error: 'Demo session capacity reached.' });
    const id = randomBytes(32).toString('hex');
    const csrf = randomBytes(24).toString('hex');
    sessions.set(id, { role: user.role, csrf, expires: Date.now() + SESSION_MS });
    res.cookie('demo_session', id, { httpOnly: true, sameSite: 'strict', maxAge: SESSION_MS, path: '/' });
    audit(user.role, 'login', 'allow');
    res.json({ role: user.role, csrf });
  });
  app.use('/api', (req, res, next) => {
    const id = (req.headers.cookie || '').match(/(?:^|;\s*)demo_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    const session = sessions.get(id);
    if (!session) return res.status(401).json({ error: 'Sign in first; sessions expire after 30 minutes.' });
    req.session = session;
    req.sessionId = id;
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-csrf-token'] !== session.csrf) {
      audit(session.role, 'csrf_check', 'deny');
      return res.status(403).json({ error: 'Invalid request token.' });
    }
    next();
  });
  const adminOnly = (req, res, next) => {
    if (req.session.role !== 'admin') {
      audit(req.session.role, 'admin_access', 'deny');
      return res.status(403).json({ error: 'IT admin access required.' });
    }
    next();
  };

    return { adminOnly };
  }

  return { credentials, sessions, expire, install };
}

module.exports = { createAuth };
