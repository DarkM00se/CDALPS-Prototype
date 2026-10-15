// Draw the page. Permission checks remain on the server.
export const $ = id => document.getElementById(id);

export function message(text, error = false) {
  $('message').textContent = text;
  $('message').className = error ? 'error' : '';
}

export function showLogin() {
  $('workspace').hidden = true;
  $('loginPanel').hidden = false;
  $('password').value = '';
  for (const id of ['customers', 'requests', 'audit']) $(id).replaceChildren();
  $('purpose').value = '';
  $('exportResult').textContent = '';
  $('policySummary').textContent = '';
}

export function showWorkspace(role) {
  $('loginPanel').hidden = true;
  $('workspace').hidden = false;
  $('adminPanel').hidden = role !== 'admin';
  $('identity').textContent = `Signed in as ${role === 'admin' ? 'IT admin' : role}`;
}

function cell(row, value) {
  const td = document.createElement('td');
  td.textContent = value;
  row.append(td);
  return td;
}

export function selectedCustomerIds() {
  return [...document.querySelectorAll('#customers input:checked')].map(input => Number(input.value));
}

export function renderCustomers(customers) {
  const selected = new Set(selectedCustomerIds());
  $('customers').replaceChildren();
  for (const customer of customers) {
    const row = document.createElement('tr');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = customer.id;
    checkbox.checked = selected.has(customer.id);
    checkbox.setAttribute('aria-label', `Select ${customer.name}`);
    cell(row, '').append(checkbox);
    for (const key of ['name', 'email', 'company', 'classification']) cell(row, customer[key]);
    $('customers').append(row);
  }
}

export function renderPolicy(policy, role) {
  $('policySummary').textContent = [
    `Version ${policy.version}`,
    `Staff exports ${policy.staffExport ? 'enabled' : 'disabled'}`,
    `Maximum ${policy.maxRows} rows`,
    `Approval above ${policy.approvalThreshold} rows`,
    `Sensitive exports ${policy.blockSensitive ? 'blocked' : 'enabled'}`,
    `Partner requests ${policy.allowPartner ? 'enabled' : 'disabled'}`
  ].join(' · ');
  if (role === 'admin') {
    for (const key of ['staffExport', 'blockSensitive', 'allowPartner']) $(key).checked = policy[key];
    for (const key of ['maxRows', 'approvalThreshold']) $(key).value = policy[key];
  }
}

function actionButton(parent, label, action) {
  const button = document.createElement('button');
  button.textContent = label;
  button.onclick = async () => {
    button.disabled = true;
    try { await action(); }
    catch (error) { message(error.message, true); }
    finally { button.disabled = false; }
  };
  parent.append(button);
}

export function renderRequests(requests, role, actions) {
  $('requests').replaceChildren();
  if (!requests.length) $('requests').textContent = 'No active requests. Use Refresh after an IT review.';
  for (const request of requests) {
    const box = document.createElement('div');
    box.className = 'request';
    const summary = document.createElement('p');
    summary.textContent = `${request.owner} · ${request.status} · Customer IDs ${request.ids.join(', ')} · ${request.destination} · ${request.purpose} · Expires ${new Date(request.expires).toLocaleTimeString()}`;
    box.append(summary);
    if (role === 'admin' && request.status === 'pending') {
      actionButton(box, 'Approve', () => actions.review(request.id, 'approve'));
      actionButton(box, 'Reject', () => actions.review(request.id, 'reject'));
    }
    if (role !== 'admin' && request.status === 'approved') {
      actionButton(box, 'Download approved CSV', () => actions.download(request.id));
    }
    $('requests').append(box);
  }
}

export function renderAudit(events) {
  $('audit').replaceChildren();
  for (const event of events) {
    const row = document.createElement('tr');
    for (const key of ['time', 'actor', 'action', 'decision']) cell(row, event[key]);
    const { id, time, actor, action, decision, ...details } = event;
    cell(row, JSON.stringify(details));
    $('audit').append(row);
  }
}

export function downloadCsv(csv) {
  if (!csv) return;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'fictional-customers.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
