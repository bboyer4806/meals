/**
 * The name for a sign-in cookie: the session, or Google sign-in's state or code verifier (design
 * 4.5). Over https it starts with `__Host-`. Browsers keep a cookie so named only when it's Secure,
 * with Path=/ and no Domain attribute, so another dev.boyersoftware.com app can't plant one for
 * Meals. Over http, as in development on localhost, it keeps the plain name.
 */
export function cookieName(url: URL, name: string): string {
	return url.protocol === 'https:' ? `__Host-${name}` : name;
}
