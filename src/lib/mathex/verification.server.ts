import type { IncomingMessage } from "node:http";

/** Validate the initial handshake only. Existing Engine.IO sessions keep running. */
export async function verifyConnection(request: Pick<IncomingMessage, "headers">): Promise<200 | 403 | 503> {
  const endpoint = process.env.ANUBIS_CHECK_URL;
  if (!endpoint) return 200;
  try {
    const response = await fetch(endpoint, {
      headers: {
        Cookie: request.headers.cookie || "",
        "User-Agent": request.headers["user-agent"] || "",
        "CF-Connecting-IP": String(request.headers["cf-connecting-ip"] || ""),
        Host: request.headers.host || ""
      },
      redirect: "manual",
      signal: AbortSignal.timeout(3000)
    });
    await response.body?.cancel();
    return response.status === 200 ? 200 : response.status === 401 || response.status === 403 ? 403 : 503;
  } catch {
    return 503;
  }
}
