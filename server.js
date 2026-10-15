'use strict';
const express = require('express');
const path = require('node:path');
const { createStore } = require('./lib/store');
const { createAuth } = require('./lib/auth');
const { installRoutes } = require('./lib/routes');

// The entry point connects storage, authentication, routes and the frontend.
function createApp(options = {}) {
  const app = express();
  const store = createStore(options.dataDir || __dirname);
  const auth = createAuth(store, options);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    auth.expire();
    res.set({
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store'
    });
    // Bound to loopback; reject foreign Host/Origin to reduce DNS rebinding and CSRF.
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) return res.status(403).json({ error: 'Local host required.' });
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return res.status(403).json({ error: 'Same-origin requests required.' });
    next();
  });
  app.use(express.json({ limit: '8kb' }));

  const { adminOnly } = auth.install(app);
  installRoutes(app, store, auth, adminOnly);

  app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API route.' }));
  app.use(express.static(path.join(__dirname, 'public'), { etag: false }));
  app.use((err, req, res, next) => {
    const status = err.status === 413 ? 413 : err instanceof SyntaxError ? 400 : 500;
    res.status(status).json({ error: status === 500 ? 'Unexpected server error.' : 'Invalid or oversized JSON body.' });
  });
  return { app, credentials: auth.credentials };
}
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  const { app, credentials } = createApp();
  app.listen(port, '127.0.0.1', () => {
    console.log(`\nCDALPS demo: http://127.0.0.1:${port}\nLocal demo accounts (new passwords each restart):`);
    for (const [role, password] of Object.entries(credentials)) console.log(`  ${role}: ${password}`);
    console.log('Policies and audit logs are saved to JSON. Sessions and approval requests reset on restart. Ctrl+C stops the server.\n');
  });
}
module.exports = { createApp };
