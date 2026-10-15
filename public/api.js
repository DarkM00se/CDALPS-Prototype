// All communication with the server goes through this module.
export const session = { role: null, csrf: null };

export function setSession(account) {
  session.role = account?.role || null;
  session.csrf = account?.csrf || null;
}

export async function api(url, method = 'GET', body) {
  const headers = { 'Content-Type': 'application/json' };
  if (session.csrf) headers['X-CSRF-Token'] = session.csrf;
  const response = await fetch(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const data = await response.json();
  const exportDenied = url === '/api/exports' && data.decision === 'deny';
  if (!response.ok && !exportDenied) {
    if (response.status === 401) {
      setSession(null);
      document.dispatchEvent(new Event('session-expired'));
    }
    throw new Error(data.error || data.reason || 'Request failed.');
  }
  return data;
}
