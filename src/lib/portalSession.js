export const PORTAL_USERNAME_SESSION_KEY = 'qc-deployment-username';

export function getStoredPortalUsername() {
  if (typeof sessionStorage === 'undefined') return '';
  return sessionStorage.getItem(PORTAL_USERNAME_SESSION_KEY)?.trim() || '';
}
