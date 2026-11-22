import type { SessionUser } from '#lib/server/auth/session.ts';

declare global {
	namespace App {
		interface Error {
			/** The id the log has for an unexpected error, which the error page shows (design 4.5). */
			id?: string;
		}

		interface Locals {
			user: SessionUser | null;
		}

		interface PageState {
			/** What Import recipes did, for Recipes to say (design 7, Import recipes). */
			importSummary?: string;
		}
	}
}

export {};
