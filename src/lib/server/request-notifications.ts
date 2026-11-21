import { listMembers } from './data/households.ts';
import type { NewRequest } from './data/requests.ts';
import { escapeHtml, sendEmail, type Email } from './email.ts';

// Request emails (design 6.12, MEA-254): a new request, from the Menu or a recipe's page, emails
// everyone else in the household, so it doesn't go unnoticed until someone opens the Menu. Each
// member gets their own email, sent once the request is saved, so an email Resend refuses or
// doesn't answer in time never undoes the request or stops the others. The app's log says whose
// email failed, by member id rather than address, and Resend's answer, never the API key.

/**
 * Emails each of the household's other members about the request just saved, linking to the Menu
 * at `origin`, the app's address as the request reached it. Waits for every email, logging each one
 * that fails rather than throwing.
 */
export async function notifyRequest(
	householdId: number,
	request: NewRequest,
	origin: string
): Promise<void> {
	const members = listMembers(householdId);
	const asker = members.find((member) => member.id === request.userId);
	// A member of the household saved the request a moment ago.
	if (!asker) throw new Error(`Member ${request.userId} isn't in household ${householdId}`);
	const email = requestEmail(request, asker.displayName, new URL('/menu', origin).href);
	const others = members.filter((member) => member.id !== asker.id);
	await Promise.all(
		others.map(async (member) => {
			try {
				await sendEmail({ to: member.email, ...email });
			} catch (e) {
				console.error(`The request email to member ${member.id} was not sent:`, e);
			}
		})
	);
}

/**
 * The same text in both versions: who asked, named as the household sees them (6.1), for a dish or
 * a restaurant, and its name, then its note when it has one, and the link to the Menu, where the
 * household's requests are. The HTML escapes the names and note, so they show as typed.
 */
function requestEmail(request: NewRequest, askedBy: string, menuUrl: string): Omit<Email, 'to'> {
	const what = request.kind === 'dish' ? 'a dish' : 'a restaurant';
	const subject = `${askedBy} requested ${what}: ${request.name}`;
	const note = request.note === null ? [] : [`Note: ${request.note}`];
	const name = `<strong>${escapeHtml(request.name)}</strong>`;
	return {
		subject,
		html: [
			`<p>${escapeHtml(askedBy)} requested ${what}: ${name}</p>`,
			...note.map((line) => `<p>${escapeHtml(line)}</p>`),
			`<p><a href="${escapeHtml(menuUrl)}">See it on the Menu</a></p>`
		].join('\n'),
		text: [subject, ...note, '', `See it on the Menu: ${menuUrl}`].join('\n')
	};
}
