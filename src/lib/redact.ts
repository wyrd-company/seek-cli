/**
 * Redaction of the parts of a URL that can carry a credential: the user name
 * and password, the query and the fragment. Every URL seek prints in an error
 * or in `seek config show` goes through `redactUrl`.
 */
const URL_PARTS = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*@)?([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i;

export const REDACTED = "<redacted>";

/** A URL with any user information, query or fragment replaced by `<redacted>`; other text unchanged. */
export function redactUrl(value: string): string {
  const match = URL_PARTS.exec(value);
  if (!match) return value;
  const [, scheme, userinfo, host, path, query, fragment] = match;
  return `${scheme}${userinfo ? `${REDACTED}@` : ""}${host}${path}${query ? `?${REDACTED}` : ""}${fragment ? `#${REDACTED}` : ""}`;
}

/** Every URL in a message, redacted. */
export function redactUrls(text: string): string {
  return text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"`<>]+/gi, (url) => redactUrl(url));
}
