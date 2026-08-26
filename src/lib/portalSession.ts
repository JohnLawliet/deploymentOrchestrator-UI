export const PORTAL_USERNAME_SESSION_KEY = 'qc-deployment-username';
export const PORTAL_TAB_ID_SESSION_KEY = 'qc-portal-tab-id';

export function getStoredPortalUsername() {
  if (typeof sessionStorage === 'undefined') return '';
  return sessionStorage.getItem(PORTAL_USERNAME_SESSION_KEY)?.trim() || '';
}

const fallbackUuid = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

/** A portal identity belongs to one browser tab and survives reloads in that tab. */
export function getPortalTabId(): string {
  if (typeof sessionStorage === 'undefined') return '';
  const existing = sessionStorage.getItem(PORTAL_TAB_ID_SESSION_KEY)?.trim();
  if (existing) return existing;
  const created = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : fallbackUuid();
  sessionStorage.setItem(PORTAL_TAB_ID_SESSION_KEY, created);
  return created;
}
