import { env } from "cloudflare:workers";

export function rejectUnsafeRequest(request: Request): Response | null {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site" || (origin && origin !== new URL(request.url).origin)) {
    return Response.json({ error: "Solicitud no permitida." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "La solicitud debe enviarse como JSON." }, { status: 415 });
  }
  return null;
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function validSetupKey(value: unknown) {
  const expected = env.VUKOVA_SETUP_TOKEN_SHA256;
  if (!expected || typeof value !== "string" || value.length < 32 || value.length > 256) return false;
  const actual = await sha256(value);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < actual.length; i += 1) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

// A single atomic UPSERT per key keeps counters shared across Worker instances.
export async function limitAuthAttempts(request: Request, account: string) {
  if (!env.DB) throw new Error("D1 binding unavailable");
  const now = Math.floor(Date.now() / 1000);
  const windowSeconds = 15 * 60;
  const address = request.headers.get("cf-connecting-ip") ?? "unknown";
  const limits = [
    { key: await sha256(`ip:${address}`), maximum: 60 },
    { key: await sha256(`account:${account}`), maximum: 10 },
  ];
  const results = await env.DB.batch<{ attempts: number; reset_at: number }>(limits.map(({ key }) => env.DB!.prepare(
    `INSERT INTO auth_attempts (key, attempts, reset_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       attempts = CASE WHEN reset_at <= ? THEN 1 ELSE attempts + 1 END,
       reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END
     RETURNING attempts, reset_at`,
  ).bind(key, now + windowSeconds, now, now)));
  const blocked = results.findIndex((result, i) => Number(result.results[0]?.attempts ?? 0) > limits[i].maximum);
  if (blocked < 0) return null;
  const retryAfter = Math.max(1, Number(results[blocked].results[0]?.reset_at ?? now + windowSeconds) - now);
  return Response.json({ error: "Demasiados intentos. Esperá unos minutos antes de volver a intentar." }, {
    status: 429,
    headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" },
  });
}

export async function clearAccountAttempts(account: string) {
  if (!env.DB) throw new Error("D1 binding unavailable");
  await env.DB.prepare("DELETE FROM auth_attempts WHERE key = ?").bind(await sha256(`account:${account}`)).run();
}
