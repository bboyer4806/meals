import type { SessionUser } from '#lib/server/auth/session.ts';

declare global {
	namespace App {
		interface Locals {
			user: SessionUser | null;
		}
	}
}

export {};
