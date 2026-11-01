/** HttpOnly cookie: browser origin where login started (for post-OAuth redirect). */
export const DISCORD_OAUTH_RETURN_COOKIE = "discord_oauth_return";

export function refererToTrustedOrigin(referer: string | undefined): string | null {
  if (!referer?.trim()) {
    return null;
  }
  try {
    const u = new URL(referer.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return null;
    }
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * After OAuth, choose dashboard base URL. Prefer cookie from Referer at /api/auth/discord when it is
 * same-origin policy-safe vs FRONTEND_URL: exact origin match, or both loopback (localhost / 127.0.0.1)
 * with same protocol so e.g. FRONTEND_URL :5175 + browsing :5173 still returns to :5173.
 */
export function resolvePostOAuthFrontendBase(
  returnCookie: string | undefined,
  configuredFrontendUrl: string,
): string {
  const configured = configuredFrontendUrl.replace(/\/$/, "");
  const raw = returnCookie?.trim();
  if (!raw) {
    return configured;
  }
  const candidate = raw.replace(/\/$/, "");
  if (isAllowedOAuthReturnOrigin(candidate, configured)) {
    return candidate;
  }
  return configured;
}

function isAllowedOAuthReturnOrigin(
  candidateOrigin: string,
  configuredFrontendUrl: string,
): boolean {
  try {
    const r = new URL(candidateOrigin);
    const f = new URL(configuredFrontendUrl);
    if (r.origin === f.origin) {
      return true;
    }
    const loop = new Set(["localhost", "127.0.0.1"]);
    if (loop.has(r.hostname) && loop.has(f.hostname) && r.protocol === f.protocol) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
