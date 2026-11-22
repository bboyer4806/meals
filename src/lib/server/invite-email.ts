import { escapeHtml, type Email } from './email.ts';

// Invite emails (design 6.1, MEA-26): a new invite emails the address invited, so whoever invited
// them doesn't have to tell them. It says what they're invited to and how to accept: sign in with
// Google using that address, from the sign-in page it links to. The Household and Admin pages send
// it with sendEmail once the invite is saved.

/**
 * The email inviting `to` to join the household named `householdName`, or, for null, to start a
 * household of their own, as createInvite takes null. It links to the sign-in page at `origin`, the
 * app's address as the invite reached it. Both versions have the same text, and the HTML escapes
 * it, so the household's name shows as typed.
 */
export function inviteEmail(to: string, householdName: string | null, origin: string): Email {
	const signInUrl = new URL('/login', origin).href;
	const invited = householdName === null ? 'start a household' : `join ${householdName}`;
	const subject = `You're invited to ${invited} on Meals`;
	const accept =
		householdName === null
			? `To start it, sign in with Google using ${to}. Meals then asks for your household's name, usual number of servings and time zone.`
			: `To join, sign in with Google using ${to}.`;
	// What Meals is, in the sign-in page's words.
	const paragraphs = [`${subject}: groceries, recipes and dinner plans for your household.`, accept];
	return {
		to,
		subject,
		html: [
			...paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
			`<p><a href="${escapeHtml(signInUrl)}">Sign in to Meals</a></p>`
		].join('\n'),
		text: [...paragraphs, `Sign in to Meals: ${signInUrl}`].join('\n\n')
	};
}
