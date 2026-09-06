/**
 * A client-supplied post-auth destination is only honored when it is a local
 * path — `/`-prefixed and not `//` (which the browser reads as a protocol-
 * relative URL to another host). Shared by the auth server actions and the
 * login/signup pages, so it lives outside the `"use server"` module.
 */
export function safeNextPath(raw: unknown, fallback: string): string {
  return typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//")
    ? raw
    : fallback;
}
