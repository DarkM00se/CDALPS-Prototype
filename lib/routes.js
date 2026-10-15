'use strict';
const { randomBytes } = require('node:crypto');
const { policyKeys, isValidPolicy, evaluateExport, csvFor } = require('./policy');
const APPROVAL_MS = 10 * 60 * 1000;

function installRoutes(app, store, auth, adminOnly) {
  const { customers, requests, audit } = store;
  const { sessions } = auth;
  let policy = store.getPolicy();
  app.get('/api/me', (req, res) => res.json({ role: req.session.role, csrf: req.session.csrf }));
  app.post('/api/logout', (req, res) => {
    sessions.delete(req.sessionId);
    res.clearCookie('demo_session', { path: '/', httpOnly: true, sameSite: 'strict' });
    audit(req.session.role, 'logout', 'allow');
    res.json({ ok: true });
  });
  app.get('/api/customers', (req, res) => {
    audit(req.session.role, 'view_customers', 'allow');
    res.json(customers.map(c => ({ ...c, email: req.session.role === 'staff' || c.classification === 'sensitive' ? '[masked]' : c.email })));
  });
  app.get('/api/policy', (req, res) => res.json(policy));
  app.put('/api/policy', adminOnly, (req, res) => {
    const p = req.body;
    const keys = policyKeys;
    if (!p || Object.keys(p).length !== keys.length || !keys.every(key => Object.hasOwn(p, key)) || !isValidPolicy(p, customers)) {
      return res.status(400).json({ error: `Use valid booleans and row limits from 1–${customers.length}; approval threshold cannot exceed maximum.` });
    }
    const before = policy;
    store.savePolicy({ ...p, version: policy.version + 1 });
    policy = store.getPolicy();
    for (const request of requests.values()) if (['pending', 'approved'].includes(request.status)) request.status = 'invalidated';
    audit('admin', 'policy_update', 'allow', { before, after: policy });
    res.json(policy);
  });
  app.post('/api/exports', (req, res) => {
    const input = req.body;
    if (!input || !Array.isArray(input.ids) || !input.ids.length || input.ids.length > customers.length ||
        new Set(input.ids).size !== input.ids.length || !input.ids.every(id => Number.isInteger(id) && customers.some(c => c.id === id)) ||
        !['internal', 'partner'].includes(input.destination) || typeof input.purpose !== 'string' ||
        input.purpose.trim().length < 5 || input.purpose.length > 200) return res.status(400).json({ error: 'Select valid unique customer IDs, a destination, and a purpose of 5–200 characters.' });
    const spec = { ids: [...input.ids].sort((a, b) => a - b), destination: input.destination, purpose: input.purpose.trim() };
    const result = evaluateExport(req.session.role, spec, policy, customers);
    audit(req.session.role, 'export_request', result.decision, { ...spec, policyVersion: policy.version, reason: result.reason });
    if (result.decision === 'deny') return res.status(403).json(result);
    if (result.decision === 'allow') {
      audit(req.session.role, 'export_download', 'allow', { ids: spec.ids, destination: spec.destination, policyVersion: policy.version });
      return res.json({ ...result, csv: csvFor(req.session.role, spec.ids, customers) });
    }
    if (requests.size >= 100) return res.status(429).json({ error: 'Approval queue is full. Wait for old requests to expire.' });
    const id = randomBytes(12).toString('hex');
    requests.set(id, { id, owner: req.session.role, ...spec, status: 'pending', policyVersion: policy.version, expires: Date.now() + APPROVAL_MS });
    res.status(202).json({ ...result, requestId: id });
  });
  app.get('/api/requests', (req, res) => res.json([...requests.values()].filter(r => req.session.role === 'admin' || r.owner === req.session.role)));
  app.post('/api/requests/:id/review', adminOnly, (req, res) => {
    const request = requests.get(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found or expired.' });
    if (request.status !== 'pending') return res.status(409).json({ error: 'Only pending requests can be reviewed.' });
    if (!['approve', 'reject'].includes(req.body?.decision)) return res.status(400).json({ error: 'Choose approve or reject.' });
    request.status = req.body.decision === 'approve' ? 'approved' : 'rejected';
    audit('admin', 'export_review', request.status, { requestId: request.id, owner: request.owner, ids: request.ids });
    res.json(request);
  });
  app.post('/api/requests/:id/download', (req, res) => {
    const request = requests.get(req.params.id);
    if (!request || request.owner !== req.session.role) return res.status(404).json({ error: 'Request not found or expired.' });
    if (request.status !== 'approved' || request.policyVersion !== policy.version) return res.status(409).json({ error: 'A current, unused approval is required.' });
    const result = evaluateExport(req.session.role, request, policy, customers);
    if (result.decision === 'deny') return res.status(403).json(result);
    request.status = 'downloaded'; // Consume before responding; replay cannot issue another copy.
    audit(req.session.role, 'export_download', 'allow', { requestId: request.id, ids: request.ids, destination: request.destination, policyVersion: policy.version });
    res.json({ decision: 'allow', reason: 'IT-approved export released.', csv: csvFor(req.session.role, request.ids, customers) });
  });
  app.get('/api/audit', adminOnly, (req, res) => res.json(store.getLogs()));

}

module.exports = { installRoutes };
