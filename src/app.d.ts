import type { SessionUser } from '#lib/server/auth/session.ts';

declare global {
	namespace App {
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
