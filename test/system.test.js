'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const fs = require('node:fs');
const path = require('node:path');
const { createStore } = require('../lib/store');
const project = path.join(__dirname, '..');

function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(__dirname, 'scratch-'));
  for (const name of ['users.json', 'customers.json', 'policies.json', 'audit-logs.json']) {
    fs.copyFileSync(path.join(project, name), path.join(dataDir, name));
  }
  fs.writeFileSync(path.join(dataDir, 'policies.json'), JSON.stringify({ staffExport: false, maxRows: 6, approvalThreshold: 3, blockSensitive: true, allowPartner: false, version: 1 }));
  fs.writeFileSync(path.join(dataDir, 'audit-logs.json'), '[]');
  t.after(() => {
    if (!dataDir.startsWith(__dirname + path.sep + 'scratch-')) throw new Error('Unexpected test directory');
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return dataDir;
}


test('Server enforces authentication, roles, export policy and approval lifecycle', async t => {
  const passwords = { staff: 'Test-Staff-Password-42', manager: 'Test-Manager-Password-42', admin: 'Test-Admin-Password-42' };
  const { app } = createApp({ passwords, dataDir: fixture(t) });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(route, method = 'GET', body, account, extraHeaders = {}) {
    const response = await fetch(base + route, { method, headers: {
      'Content-Type': 'application/json', ...(account ? { Cookie: account.cookie, 'X-CSRF-Token': account.csrf } : {}), ...extraHeaders
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  async function login(username) {
    const result = await call('/api/login', 'POST', { username, password: passwords[username] });
    assert.equal(result.status, 200);
    const cookie = result.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Strict/i);
    return { cookie: cookie.split(';')[0], csrf: result.data.csrf };
  }
  const spec = { ids: [1, 2], destination: 'internal', purpose: 'Monthly report' };
  assert.equal((await call('/api/customers')).status, 401);
  assert.equal((await call('/api/login', 'POST', { username: 'manager', password: 'wrong' })).status, 401);
  assert.equal((await call('/api/login', 'POST', { username: 'manager', password: passwords.manager }, undefined, { Origin: 'https://evil.example' })).status, 403);
  const staff = await login('staff'), manager = await login('manager'), admin = await login('admin');
  assert.equal((await call('/api/customers', 'GET', undefined, staff)).data[0].email, '[masked]');
  assert.equal((await call('/api/customers', 'GET', undefined, manager)).data[6].email, '[masked]');
  assert.equal((await call('/api/exports', 'POST', { ...spec, role: 'manager' }, staff)).data.decision, 'deny');
  assert.equal((await call('/api/exports', 'POST', spec, manager, { 'X-CSRF-Token': 'forged' })).status, 403);
  assert.equal((await call('/api/audit', 'GET', undefined, manager)).status, 403);
  const p = (await call('/api/policy', 'GET', undefined, admin)).data;
  const { version, ...policy } = p;
  assert.equal((await call('/api/policy', 'PUT', policy, staff)).status, 403);
  assert.equal((await call('/api/policy', 'PUT', { ...policy, maxRows: 0 }, admin)).status, 400);
  const allowed = await call('/api/exports', 'POST', spec, manager);
  assert.equal(allowed.data.decision, 'allow'); assert.ok(allowed.data.csv.includes(JSON.parse(fs.readFileSync(path.join(project, 'customers.json'), 'utf8'))[0].email));
  for (const input of [{ ...spec, ids: [7] }, { ...spec, ids: [1, 2, 3, 4, 5, 6, 7] }, { ...spec, destination: 'partner' }]) {
    const result = await call('/api/exports', 'POST', input, manager);
    assert.equal(result.status, 403); assert.equal(result.data.csv, undefined);
  }
  for (const ids of [[1, 1], [99], ['1'], []]) assert.equal((await call('/api/exports', 'POST', { ...spec, ids }, manager)).status, 400);
  const bigSpec = { ...spec, ids: [1, 2, 3, 4] };
  const pending = await call('/api/exports', 'POST', bigSpec, manager);
  assert.equal(pending.status, 202); assert.equal(pending.data.csv, undefined);
  const id = pending.data.requestId;
  assert.equal((await call(`/api/requests/${id}/download`, 'POST', {}, manager)).status, 409);
  assert.equal((await call(`/api/requests/${id}/review`, 'POST', { decision: 'approve' }, manager)).status, 403);
  assert.equal((await call('/api/requests', 'GET', undefined, staff)).data.length, 0);
  assert.equal((await call(`/api/requests/${id}/review`, 'POST', { decision: 'approve' }, admin)).status, 200);
  assert.equal((await call(`/api/requests/${id}/download`, 'POST', {}, staff)).status, 404);
  assert.equal((await call(`/api/requests/${id}/download`, 'POST', {}, manager)).status, 200);
  assert.equal((await call(`/api/requests/${id}/download`, 'POST', {}, manager)).status, 409);
  const rejectedId = (await call('/api/exports', 'POST', bigSpec, manager)).data.requestId;
  await call(`/api/requests/${rejectedId}/review`, 'POST', { decision: 'reject' }, admin);
  assert.equal((await call(`/api/requests/${rejectedId}/download`, 'POST', {}, manager)).status, 409);
  const changedId = (await call('/api/exports', 'POST', bigSpec, manager)).data.requestId;
  await call(`/api/requests/${changedId}/review`, 'POST', { decision: 'approve' }, admin);
  const pendingId = (await call('/api/exports', 'POST', bigSpec, manager)).data.requestId;
  await call('/api/policy', 'PUT', { ...policy, staffExport: true, allowPartner: true }, admin);
  assert.equal((await call(`/api/requests/${changedId}/download`, 'POST', {}, manager)).status, 409);
  assert.equal((await call(`/api/requests/${pendingId}/review`, 'POST', { decision: 'approve' }, admin)).status, 409);
  assert.match((await call('/api/exports', 'POST', spec, staff)).data.csv, /\[masked\]/);
  assert.equal((await call('/api/exports', 'POST', { ...spec, destination: 'partner' }, manager)).data.decision, 'approval');
  assert.equal((await call('/api/exports', 'POST', spec, admin)).data.decision, 'deny');
  const logs = (await call('/api/audit', 'GET', undefined, admin)).data;
  assert.ok(logs.some(e => e.action === 'export_request' && e.decision === 'deny'));
  assert.ok(logs.some(e => e.action === 'policy_update'));
  assert.ok(logs.some(e => e.action === 'export_review' && e.decision === 'approved'));
  assert.ok(!JSON.stringify(logs).includes(passwords.manager));
  await call('/api/logout', 'POST', {}, manager);
  assert.equal((await call('/api/customers', 'GET', undefined, manager)).status, 401);
});

test('Login attempt limit is enforced', async t => {
  const { app } = createApp({ dataDir: fixture(t) });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/login`;
  for (let i = 0; i < 11; i++) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'staff', password: 'wrong' }) });
    assert.equal(response.status, i < 10 ? 401 : 429);
    await response.json();
  }
});

test('JSON policies and audit events survive restart; files are not exposed', async t => {
  const dataDir = fixture(t);
  const store = createStore(dataDir);
  store.savePolicy({ ...store.getPolicy(), staffExport: true, version: 2 });
  store.audit('admin', 'policy_update', 'allow');
  const restarted = createStore(dataDir);
  assert.equal(restarted.getPolicy().staffExport, true);
  assert.equal(restarted.getPolicy().version, 2);
  assert.equal(restarted.getLogs()[0].action, 'policy_update');
  assert.equal(restarted.requests.size, 0);
  const { app } = createApp({ dataDir });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const filename of ['users.json', 'customers.json', 'policies.json', 'audit-logs.json']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/${filename}`);
    assert.equal(response.status, 404);
    await response.text();
  }
  fs.writeFileSync(path.join(dataDir, 'policies.json'), '{broken');
  assert.throws(() => createApp({ dataDir }), /Cannot load policies.json/);
});
