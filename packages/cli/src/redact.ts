/**
 * Credentials never leave the process through text. Imagery providers with a
 * key keep it inside the request URL (`?key=` or `?access_token=`), and URLs
 * end up in error messages, so every line the CLI prints or wraps in an
 * error goes through `redact`.
 */
const PARAM = /\b((?:api[_-]?key|key|access[_-]?token|token|auth|sig|signature|secret|password|pwd)=)[^&\s"'<>)\]]*/gi;
const SCHEME = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{6,}/g;
const USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+(?::[^/\s@]*)?@/gi;

export const REDACTED = '[redacted]';

export function redact(text: string): string {
  return text
    .replace(PARAM, `$1${REDACTED}`)
    .replace(SCHEME, `$1 ${REDACTED}`)
    .replace(USERINFO, `$1${REDACTED}@`);
}

/** Message of anything thrown, redacted. */
export function errorText(err: unknown): string {
  const parts: string[] = [];
  let e: unknown = err;
  for (let depth = 0; e !== undefined && e !== null && depth < 4; depth++) {
    parts.push(e instanceof Error ? e.message : String(e));
    e = e instanceof Error ? e.cause : undefined;
  }
  return redact(parts.join(': '));
}
