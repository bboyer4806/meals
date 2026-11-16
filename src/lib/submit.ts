import type { ActionResult, SubmitFunction } from '$app/forms';

// What a page says when a form's action wasn't done. The page stays as it is, with any open sheet
// and what was typed, and says so by the form, as Feedback does (6.11, MEA-111). Reloading the
// page or showing the error page instead would need the server too, and lose what was typed.

/** For an action that got no answer from Meals, as when the connection dropped. */
export const UNREACHABLE = "Couldn't reach Meals. Check your connection and try again.";

/** For an action that broke on the server, or a failure that came without a message. */
export const WENT_WRONG = 'Something went wrong. Please try again.';

/**
 * The message for an action that wasn't done: a failure's own, or for an error other than a 404,
 * that Meals couldn't be reached or something went wrong there. Only an answer from the action
 * has a status; an error without one is a request that failed on the way, or that something
 * else, such as a proxy, answered. Null for a success, a redirect or a 404 (something someone
 * else removed), which the page handles.
 */
export function problemIn(result: ActionResult): string | null {
	if (result.type === 'failure') {
		return (result.data as { error?: string } | undefined)?.error ?? WENT_WRONG;
	}
	if (result.type !== 'error' || result.status === 404) return null;
	return result.status === undefined ? UNREACHABLE : WENT_WRONG;
}

/**
 * Sends a form as `submit` does, except that for an error other than a 404 nothing on the page
 * changes and `show` gets the message to put by the form.
 */
export function keepPage(
	show: (message: string) => void,
	submit?: SubmitFunction
): SubmitFunction {
	return async (input) => {
		const callback = await submit?.(input);
		return async (options) => {
			const problem = options.result.type === 'error' ? problemIn(options.result) : null;
			if (problem !== null) show(problem);
			else await (callback ? callback(options) : options.update());
		};
	};
}
