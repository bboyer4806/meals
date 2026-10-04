import { fail, isHttpError, type ActionFailure } from '@sveltejs/kit';
import { z } from 'zod';
import { isValidTimeZone } from '../dates.ts';
import { normalizeName } from '../text.ts';

// Field schemas shared by the form actions. Messages are shown to people as-is.

export const id = z.coerce.number().int().positive();

export function nameField(max: number, what: string) {
	return z
		.string()
		.transform(normalizeName)
		.pipe(
			z
				.string()
				.min(1, `Enter ${what}`)
				.max(max, `Keep ${what} under ${max} characters`)
		);
}

export function optionalText(max: number) {
	return z
		.string()
		.trim()
		.max(max, `Keep it under ${max} characters`)
		.transform((value) => (value === '' ? null : value));
}

export const quantity = z.coerce
	.number()
	.positive('Enter a quantity above 0')
	.max(10_000, 'Enter a smaller quantity');

export const emailField = z.string().trim().toLowerCase().pipe(z.email('Enter an email address'));

export const householdSettings = z.object({
	name: nameField(60, 'a household name'),
	defaultServings: z.coerce
		.number()
		.int('Enter a whole number of servings')
		.min(1, 'Enter at least 1 serving')
		.max(50, 'Enter 50 servings or fewer'),
	timeZone: z.string().refine(isValidTimeZone, 'Pick a time zone')
});

export type FormFailure = { action: string; error: string };

/** Parses form data, or returns the first problem as a message for the form named `action`. */
export function parseForm<T extends z.ZodType>(
	schema: T,
	data: FormData,
	action: string
): { data: z.output<T> } | { failure: ActionFailure<FormFailure> } {
	const result = schema.safeParse(Object.fromEntries(data));
	if (result.success) return { data: result.data };
	const error = result.error.issues[0]?.message ?? 'Check the form and try again';
	return { failure: fail(400, { action, error }) };
}

/**
 * Runs a data change for the form named `action`. A 400 thrown by the data layer (such as
 * "Pick a store first") becomes a message on the form instead of an error page.
 */
export function attempt<T>(action: string, run: () => T): T | ActionFailure<FormFailure> {
	try {
		return run();
	} catch (e) {
		if (isHttpError(e, 400)) return fail(400, { action, error: e.body.message });
		throw e;
	}
}
