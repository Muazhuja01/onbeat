/** Requests from other sites are refused; a missing Origin (same-origin GET, curl) is allowed. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    // A malformed Origin (e.g. "null") can't be same-origin.
    return false;
  }
}

/** The caller's address for rate limiting, as Vercel passes it. */
export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export function json(data: unknown, status: number): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}
