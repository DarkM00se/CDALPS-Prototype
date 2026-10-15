import { api, session, setSession } from './api.js';
import {
  $, message, showLogin, showWorkspace, selectedCustomerIds,
  renderCustomers, renderPolicy, renderRequests, renderAudit, downloadCsv
} from './views.js';

// Page actions live here. Requests and HTML rendering have their own modules.
async function refresh() {
  const [customers, policy, requests] = await Promise.all([
    api('/api/customers'), api('/api/policy'), api('/api/requests')
  ]);
  showWorkspace(session.role);
  renderCustomers(customers);
  renderPolicy(policy, session.role);
  renderRequests(requests, session.role, { review: reviewRequest, download: downloadApproved });
  if (session.role === 'admin') renderAudit(await api('/api/audit'));
}

async function signIn() {
  const account = await api('/api/login', 'POST', {
    username: $('username').value,
    password: $('password').value
  });
  setSession(account);
  $('password').value = '';
  $('exportResult').textContent = '';
  message('Signed in.');
  await refresh();
}

async function signOut() {
  await api('/api/logout', 'POST', {});
  setSession(null);
  showLogin();
  message('Signed out.');
}

async function requestExport() {
  const result = await api('/api/exports', 'POST', {
    ids: selectedCustomerIds(),
    destination: $('destination').value,
    purpose: $('purpose').value
  });
  $('exportResult').textContent = `${result.decision.toUpperCase()}: ${result.reason}`;
  message(result.reason, result.decision === 'deny');
  downloadCsv(result.csv);
  await refresh();
}

async function savePolicy() {
  const policy = {};
  for (const key of ['staffExport', 'blockSensitive', 'allowPartner']) policy[key] = $(key).checked;
  for (const key of ['maxRows', 'approvalThreshold']) policy[key] = Number($(key).value);
  await api('/api/policy', 'PUT', policy);
  message('Policy saved. Open approvals invalidated.');
  await refresh();
}

async function reviewRequest(id, decision) {
  await api(`/api/requests/${id}/review`, 'POST', { decision });
  message(`Request ${decision === 'approve' ? 'approved' : 'rejected'}.`);
  await refresh();
}

async function downloadApproved(id) {
  const result = await api(`/api/requests/${id}/download`, 'POST', {});
  downloadCsv(result.csv);
  message(result.reason);
  await refresh();
}

function onSubmit(formId, action) {
  $(formId).addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.submitter;
    if (button) button.disabled = true;
    try { await action(); }
    catch (error) { message(error.message, true); }
    finally { if (button) button.disabled = false; }
  });
}

async function restoreSession() {
  setSession(await api('/api/me'));
  await refresh();
}

onSubmit('loginForm', signIn);
onSubmit('exportForm', requestExport);
onSubmit('policyForm', savePolicy);
$('refresh').onclick = () => refresh().catch(error => message(error.message, true));
$('logout').onclick = () => signOut().catch(error => message(error.message, true));
document.addEventListener('session-expired', showLogin);
restoreSession().catch(() => showLogin());
