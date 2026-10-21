import type { Page } from '@playwright/test';
import {
	addDinner,
	addRecipe,
	expect,
	failNextJiraTicket,
	jiraTickets,
	open,
	test,
	today
} from './fixtures.ts';

// Feedback (design 7, "Feedback"): the button on every signed-in page, its sheet, and the
// tickets the stand-in Jira receives.

const feedbackButton = (page: Page) => page.getByRole('button', { name: 'Send feedback' });
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Send feedback' });
const box = (page: Page) => sheet(page).getByLabel('Feedback');
const send = (page: Page) => sheet(page).getByRole('button', { name: /^(Send|Sending…)$/ });

/** All the text in an Atlassian Document Format value, with line breaks as \n. */
function text(node: unknown): string {
	const { type, text: value, content } = node as { type: string; text?: string; content?: [] };
	if (type === 'text') return value ?? '';
	if (type === 'hardBreak') return '\n';
	return (content ?? []).map(text).join(type === 'doc' ? '\n\n' : '');
}

test('shows on signed-in pages, not on Sign in or Privacy, and not in print', async ({
	page,
	person: _signedIn
}) => {
	for (const path of ['/groceries', '/menu', '/recipes', '/household']) {
		await page.goto(path);
		await expect(feedbackButton(page)).toBeVisible();
	}
	await page.emulateMedia({ media: 'print' });
	await expect(feedbackButton(page)).toBeHidden();
	await page.emulateMedia({ media: 'screen' });

	await page.goto('/privacy');
	await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible();
	await expect(feedbackButton(page)).toHaveCount(0);

	await page.context().clearCookies();
	await page.goto('/login');
	await expect(page.getByText('Sign in with Google')).toBeVisible();
	await expect(feedbackButton(page)).toHaveCount(0);
});

test("sits above the tab bar and doesn't cover the end of a long page", async ({
	page,
	db,
	person
}) => {
	for (let n = 1; n <= 30; n += 1) addRecipe(db, person.householdId, { name: `Recipe ${n}` });
	await page.goto('/recipes');
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

	const button = await feedbackButton(page).boundingBox();
	const tabs = await page.getByRole('navigation', { name: 'Main' }).boundingBox();
	if (!button || !tabs) throw new Error('No button or tab bar');
	expect(button.y + button.height).toBeLessThanOrEqual(tabs.y);
	expect(button.x + button.width).toBeGreaterThan(page.viewportSize()!.width - 40);

	// The page's last row ends above the button.
	const contentBottom = await page.locator('main').evaluate((main) => {
		const last = main.lastElementChild;
		if (!last) throw new Error('Empty page');
		return last.getBoundingClientRect().bottom;
	});
	expect(contentBottom).toBeLessThanOrEqual(button.y);
});

test('stops at 2,000 characters, typed or pasted, and says so', async ({ page, person }) => {
	await open(page, '/groceries');
	await feedbackButton(page).click();
	await expect(sheet(page)).toBeVisible();
	await expect(sheet(page).getByText('0 / 2,000')).toBeVisible();

	await box(page).fill('a'.repeat(1998));
	await expect(sheet(page).getByText('1,998 / 2,000')).toBeVisible();
	await expect(sheet(page).getByText("You've reached the 2,000-character limit.")).toHaveCount(0);
	await box(page).press('End');
	await page.keyboard.type('bcd');
	await expect(box(page)).toHaveValue(`${'a'.repeat(1998)}bc`);
	await expect(sheet(page).getByText('2,000 / 2,000')).toBeVisible();
	await expect(sheet(page).getByText("You've reached the 2,000-character limit.")).toBeVisible();

	// A paste that would go past the limit is cut at it.
	await box(page).fill('');
	await box(page).focus();
	await page.keyboard.insertText('x'.repeat(2500));
	await expect(box(page)).toHaveValue('x'.repeat(2000));
	await expect(sheet(page).getByText('2,000 / 2,000')).toBeVisible();
	expect(await jiraTickets(person.email)).toHaveLength(0);
});

test('an empty send asks for feedback and sends nothing', async ({ page, person }) => {
	await open(page, '/groceries');
	await feedbackButton(page).click();
	await send(page).click();
	await expect(sheet(page).getByRole('alert')).toHaveText('Enter your feedback');
	await box(page).fill('   ');
	await send(page).click();
	await expect(sheet(page).getByRole('alert')).toHaveText('Enter your feedback');
	expect(await jiraTickets(person.email)).toHaveLength(0);
});

test('sends one ticket from a dinner and keeps its unsaved note', async ({ page, db, person }) => {
	const date = today();
	addDinner(db, person.householdId, date, { note: 'Saved note' });
	page.on('dialog', (dialog) => {
		throw new Error(`Unexpected dialog: ${dialog.message()}`);
	});
	await open(page, `/menu/${date}?from=week`);
	const note = page.getByLabel('Note', { exact: true });
	await note.fill('Typed, not saved');

	// Holds the send, so a second tap meets the busy button.
	let release = () => {};
	const held = new Promise<void>((resolve) => (release = resolve));
	await page.route('**/feedback', async (route) => {
		await held;
		await route.continue();
	});

	const message = `The note box is small ${person.email}\nSecond line`;
	await feedbackButton(page).click();
	await box(page).fill(message);
	await send(page).click();
	await expect(send(page)).toHaveText('Sending…');
	await expect(send(page)).toBeDisabled();
	await send(page).click({ force: true });
	release();
	await expect(sheet(page).getByText('Thanks, your feedback was sent.')).toBeVisible();
	await sheet(page).getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(sheet(page)).toBeHidden();
	await expect(note).toHaveValue('Typed, not saved');

	const tickets = await jiraTickets(person.email);
	expect(tickets).toHaveLength(1);
	const ticket = tickets[0]!;
	expect(ticket.authorization).toBe(
		`Basic ${Buffer.from('feedback@example.com:e2e-jira-token').toString('base64')}`
	);
	expect(ticket.fields).toMatchObject({
		project: { key: 'MEA' },
		issuetype: { name: 'Task' },
		labels: ['user-feedback'],
		summary: `Feedback: ${`The note box is small ${person.email}`.slice(0, 80)}`
	});
	const description = text(ticket.fields.description);
	expect(description).toContain(message);
	expect(description).toContain(`Page: /menu/${date}?from=week`);
	expect(description).toMatch(new RegExp(`From: Person \\d+ <${person.email}>`));
	expect(description).toMatch(/Household: Household \S+/);
	expect(description).toMatch(/Browser: Mozilla\/5\.0 .+/);
	expect(description).toContain('Window: 412 × 839');

	// Opening it again starts a new message.
	await feedbackButton(page).click();
	await expect(box(page)).toHaveValue('');
});

test("says it couldn't send when Jira fails, and keeps the message", async ({ page, person }) => {
	const message = `Long dish names are cut off ${person.email}`;
	await failNextJiraTicket(person.email);
	await open(page, '/menu');
	await feedbackButton(page).click();
	await box(page).fill(message);
	await send(page).click();
	await expect(sheet(page).getByRole('alert')).toHaveText(
		"Couldn't send your feedback. Try again."
	);
	await expect(box(page)).toHaveValue(message);
	expect(await jiraTickets(person.email)).toHaveLength(0);

	await send(page).click();
	await expect(sheet(page).getByText('Thanks, your feedback was sent.')).toBeVisible();
	expect(await jiraTickets(person.email)).toHaveLength(1);
});
