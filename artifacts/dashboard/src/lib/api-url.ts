/**
 * Central API base URL helper.
 *
 * - On Replit (dev / preview):  uses BASE_URL path prefix (same-origin proxy)
 * - Standalone deployment:      uses VITE_API_URL build-time env var
 *                                e.g. https://dadatcha-api.onrender.com
 *
 * Set VITE_API_URL during the Vite build to point to the deployed API server.
 */
export function getApiBase(): string {
  // VITE_API_URL is injected at build time by Vite (set as Render env var)
  const envUrl = import.meta.env.VITE_API_URL as string | undefined;
  if (envUrl) return envUrl.replace(/\/$/, '');
  // Same-origin fallback: Replit proxied setup uses BASE_URL path prefix
  return (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
}
