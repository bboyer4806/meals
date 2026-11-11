import { config } from './config.ts';

// Meals sends email through Resend's API with the RESEND_API_KEY setting, which stays on the
// server. Every email comes from the same address, on the domain verified in Resend (design 4.3).

const SEND_URL = 'https://api.resend.com/emails';
const FROM = 'Meals <noreply@meals.dev.boyersoftware.com>';
const TIMEOUT_MS = 10_000;

export type Email = {
	to: string;
	subject: string;
	html: string;
	/** The same message as plain text, for mail apps that don't show HTML. */
	text: string;
};

/**
 * Sends the email, or throws if Resend refuses it or doesn't answer in time. Resend accepting it
 * doesn't mean it was delivered.
 */
export async function sendEmail(email: Email): Promise<void> {
	const response = await fetch(SEND_URL, {
		method: 'POST',
		headers: {
			accept: 'application/json',
			'content-type': 'application/json',
			authorization: `Bearer ${config().RESEND_API_KEY}`,
			// Resend refuses a request without one.
			'user-agent': 'Meals'
		},
		body: JSON.stringify({
			from: FROM,
			to: email.to,
			subject: email.subject,
			html: email.html,
			text: email.text
		}),
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (!response.ok) {
		// Resend's answer says what's wrong, such as a domain that isn't verified, without the key.
		throw new Error(`Resend send-email request failed: ${response.status} ${await response.text()}`);
	}
}
