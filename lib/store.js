'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { isValidPolicy } = require('./policy');

// Only this module reads or writes the project's JSON data files.
function createStore(dataDir) {
  function read(name) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
      throw new Error(`Cannot load ${name}: ${error.message}`);
    }
  }

  function save(name, value) {
    const target = path.join(dataDir, name);
    const temporary = target + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temporary, target);
  }

  const users = read('users.json');
  const customers = read('customers.json');
  let policy = read('policies.json');
  let logs = read('audit-logs.json');
  const roles = ['staff', 'manager', 'admin'];
  if (!Array.isArray(users) || users.length !== 3 || !roles.every(role => users.some(user => user.username === role && user.role === role))) {
    throw new Error('users.json must define the staff, manager and admin demo accounts.');
  }
  if (!Array.isArray(customers) || !customers.length || new Set(customers.map(c => c.id)).size !== customers.length ||
      !customers.every(c => Number.isInteger(c.id) && c.id > 0 && ['name', 'email', 'company'].every(k => typeof c[k] === 'string') && ['standard', 'sensitive'].includes(c.classification))) {
    throw new Error('customers.json contains invalid customer records.');
  }
  if (!isValidPolicy(policy, customers) || !Number.isInteger(policy.version) || policy.version < 1) {
    throw new Error('policies.json contains invalid limits or settings.');
  }
  if (!Array.isArray(logs) || !logs.every(event => event && ['id', 'time', 'actor', 'action', 'decision'].every(key => typeof event[key] === 'string'))) {
    throw new Error('audit-logs.json must contain an array of audit events.');
  }
  logs = logs.slice(-500);
  const requests = new Map();

  function audit(actor, action, decision, details = {}) {
    const event = { id: randomBytes(8).toString('hex'), time: new Date().toISOString(), actor, action, decision, ...details };
    const updated = [...logs, event].slice(-500);
    save('audit-logs.json', updated);
    logs = updated;
  }

  function savePolicy(updated) {
    save('policies.json', updated);
    policy = updated;
  }

  return { users, customers, requests, audit, savePolicy, getPolicy: () => policy, getLogs: () => [...logs].reverse() };
}

module.exports = { createStore };
