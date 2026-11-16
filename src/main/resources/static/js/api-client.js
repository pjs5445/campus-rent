const base = typeof document === 'undefined' ? '' : (document.querySelector('meta[name="app-base"]')?.content || '').replace(/\/$/, '');
let csrfToken = null;
export function resetSession() { csrfToken = null; }
export async function getSession() {
  const session = await api('/session');
  csrfToken = session.csrfToken;
  return session;
}
export async function api(path, options = {}) {
  const method = options.method || 'GET';
  if (method !== 'GET' && !csrfToken) await getSession();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`${base}/api${path}`, {
      method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: { Accept: 'application/json', ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) resetSession();
      const error = new Error(data.message || '요청을 처리하지 못했습니다.');
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('서버 응답이 지연되었습니다. 조회로 처리 결과를 확인한 후 다시 시도해주세요.');
    throw error;
  } finally { clearTimeout(timeout); }
}
