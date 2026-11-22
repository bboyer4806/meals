import { describe, expect, it } from 'vitest';
import { inviteEmail } from './invite-email.ts';

const ORIGIN = 'https://meals.example.com';

describe('inviteEmail (6.1, MEA-26)', () => {
	it('invites the address to join the household by name, linking to the sign-in page', () => {
		expect(inviteEmail('pat@example.com', 'The Smiths', ORIGIN)).toEqual({
			to: 'pat@example.com',
			subject: "You're invited to join The Smiths on Meals",
			html: [
				'<p>You&#39;re invited to join The Smiths on Meals: groceries, recipes and dinner plans for your household.</p>',
				'<p>To join, sign in with Google using pat@example.com.</p>',
				'<p><a href="https://meals.example.com/login">Sign in to Meals</a></p>'
			].join('\n'),
			text: [
				"You're invited to join The Smiths on Meals: groceries, recipes and dinner plans for your household.",
				'',
				'To join, sign in with Google using pat@example.com.',
				'',
				'Sign in to Meals: https://meals.example.com/login'
			].join('\n')
		});
	});

	it("invites the admin's invitee to start a household, saying how to set it up", () => {
		expect(inviteEmail('pat@example.com', null, ORIGIN)).toEqual({
			to: 'pat@example.com',
			subject: "You're invited to start a household on Meals",
			html: [
				'<p>You&#39;re invited to start a household on Meals: groceries, recipes and dinner plans for your household.</p>',
				'<p>To start it, sign in with Google using pat@example.com. Meals then asks for your ' +
					'household&#39;s name, usual number of servings and time zone.</p>',
				'<p><a href="https://meals.example.com/login">Sign in to Meals</a></p>'
			].join('\n'),
			text: [
				"You're invited to start a household on Meals: groceries, recipes and dinner plans for your household.",
				'',
				'To start it, sign in with Google using pat@example.com. Meals then asks for your ' +
					"household's name, usual number of servings and time zone.",
				'',
				'Sign in to Meals: https://meals.example.com/login'
			].join('\n')
		});
	});

	it('links to the sign-in page at the address the invite was sent to', () => {
		const email = inviteEmail('pat@example.com', 'The Smiths', 'http://localhost:5173');
		expect(email.html).toContain('<a href="http://localhost:5173/login">Sign in to Meals</a>');
		expect(email.text).toContain('Sign in to Meals: http://localhost:5173/login');
	});

	it('shows the household name and address as typed, so they never change the HTML', () => {
		const email = inviteEmail("o'neil@example.com", '<b>Bob</b> & "Sons"', ORIGIN);
		expect(email.subject).toBe(`You're invited to join <b>Bob</b> & "Sons" on Meals`);
		expect(email.html).toContain(
			'<p>You&#39;re invited to join &lt;b&gt;Bob&lt;/b&gt; &amp; &quot;Sons&quot; on Meals:'
		);
		expect(email.html).toContain('<p>To join, sign in with Google using o&#39;neil@example.com.</p>');
		expect(email.html).not.toContain('<b>');
		expect(email.text).toContain(`You're invited to join <b>Bob</b> & "Sons" on Meals:`);
		expect(email.text).toContain("To join, sign in with Google using o'neil@example.com.");
	});
});
