import type { ActionResult, SubmitFunction } from '$app/forms';
import { describe, expect, it, vi } from 'vitest';
import { UNREACHABLE, WENT_WRONG, keepPage, problemIn } from './submit.ts';

// Where the results say the action landed: its page, without ?/receive.
const location = '/groceries';

// As SvelteKit's enhance gives them. A request that failed on the way has no status of its own,
// though its error says 500, and an action that broke on the server answers with its own.
const internal = { status: 500, message: 'Internal Error' };
const unanswered: ActionResult = { type: 'error', error: internal };
const broke: ActionResult = { type: 'error', status: 500, error: internal, location };
const gone: ActionResult = {
	type: 'error',
	status: 404,
	error: { status: 404, message: 'Not found' },
	location
};
const refused: ActionResult = {
	type: 'failure',
	status: 400,
	data: { action: 'add', error: 'Enter a quantity above 0' },
	location
};
const saved: ActionResult = { type: 'success', status: 200, data: { action: 'add' }, location };

describe('problemIn', () => {
	it("gives a failure's own message, or a general one when it has none", () => {
		expect(problemIn(refused)).toBe('Enter a quantity above 0');
		expect(problemIn({ type: 'failure', status: 400, location })).toBe(WENT_WRONG);
	});

	it("says Meals couldn't be reached for an error without a status", () => {
		expect(problemIn(unanswered)).toBe(UNREACHABLE);
	});

	it('says something went wrong for an error the server answered with', () => {
		expect(problemIn(broke)).toBe(WENT_WRONG);
		expect(problemIn({ ...broke, status: 503 })).toBe(WENT_WRONG);
	});

	it('leaves a success, a redirect and a 404 to the page', () => {
		expect(problemIn(saved)).toBeNull();
		expect(problemIn({ type: 'redirect', status: 303, location: '/login' })).toBeNull();
		expect(problemIn(gone)).toBeNull();
	});
});

describe('keepPage', () => {
	/** Sends a form with `submit` as SvelteKit's enhance does, answered with `result`. */
	async function send(submit: SubmitFunction, result: ActionResult) {
		const input = {
			action: new URL(`http://localhost${location}?/receive`),
			formData: new FormData(),
			formElement: {} as HTMLFormElement,
			controller: new AbortController(),
			submitter: null,
			cancel: () => {}
		};
		const update = vi.fn(async () => {});
		const callback = await submit(input);
		await callback?.({ ...input, result, update });
		return update;
	}

	it('shows the message for an error other than a 404, and changes nothing else', async () => {
		const show = vi.fn();
		const callback = vi.fn();
		const before = vi.fn(() => callback);
		expect(await send(keepPage(show, before), unanswered)).not.toHaveBeenCalled();
		expect(show).toHaveBeenCalledWith(UNREACHABLE);
		expect(await send(keepPage(show, before), broke)).not.toHaveBeenCalled();
		expect(show).toHaveBeenLastCalledWith(WENT_WRONG);
		// What the form does before it's sent still runs.
		expect(before).toHaveBeenCalledTimes(2);
		expect(callback).not.toHaveBeenCalled();
	});

	it("hands any other result to the form's own callback", async () => {
		const show = vi.fn();
		const callback = vi.fn();
		for (const result of [saved, refused, gone]) {
			await send(
				keepPage(show, () => callback),
				result
			);
			expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({ result }));
		}
		expect(show).not.toHaveBeenCalled();
	});

	it('applies any other result as SvelteKit does when the form has no callback', async () => {
		const show = vi.fn();
		expect(await send(keepPage(show), saved)).toHaveBeenCalledOnce();
		expect(await send(keepPage(show), gone)).toHaveBeenCalledOnce();
		expect(show).not.toHaveBeenCalled();
	});
});
