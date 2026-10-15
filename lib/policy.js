'use strict';
const policyKeys = ['staffExport', 'maxRows', 'approvalThreshold', 'blockSensitive', 'allowPartner'];

function isValidPolicy(policy, customers) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return false;
  if (!['staffExport', 'blockSensitive', 'allowPartner'].every(key => typeof policy[key] === 'boolean')) return false;
  if (!['maxRows', 'approvalThreshold'].every(key => Number.isInteger(policy[key]) && policy[key] >= 1 && policy[key] <= customers.length)) return false;
  return policy.approvalThreshold <= policy.maxRows;
}

  function evaluateExport(role, input, policy, customers) {
    if (role === 'admin') return { decision: 'deny', reason: 'IT administrators oversee policy and approvals; use a manager account to export.' };
    if (role === 'staff' && !policy.staffExport) return { decision: 'deny', reason: 'Staff exports are disabled by IT policy.' };
    if (input.ids.length > policy.maxRows) return { decision: 'deny', reason: `Maximum export size is ${policy.maxRows} rows.` };
    if (policy.blockSensitive && input.ids.some(id => customers.find(c => c.id === id).classification === 'sensitive')) return { decision: 'deny', reason: 'Sensitive customer exports are blocked.' };
    if (input.destination === 'partner' && !policy.allowPartner) return { decision: 'deny', reason: 'Partner exports are disabled.' };
    if (input.destination === 'partner' || input.ids.length > policy.approvalThreshold) return { decision: 'approval', reason: 'IT approval is required for this export.' };
    return { decision: 'allow', reason: 'Export meets the current policy.' };
  }
  function csvFor(role, ids, customers) {
    const cell = value => '"' + String(value).replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""') + '"';
    return ['id,name,email,company,classification', ...customers.filter(c => ids.includes(c.id)).map(c =>
      [c.id, c.name, role === 'staff' ? '[masked]' : c.email, c.company, c.classification].map(cell).join(','))].join('\r\n');
  }

module.exports = { policyKeys, isValidPolicy, evaluateExport, csvFor };
