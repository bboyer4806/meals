import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { TEST_ENV } from './testing.ts';

describe('loadConfig', () => {
	it('reads the settings', () => {
		expect(loadConfig({ ...TEST_ENV, DATA_DIR: '/data' })).toMatchObject({
			JIRA_URL: 'https://jira.example.com',
			JIRA_EMAIL: 'feedback@example.com',
			JIRA_API_TOKEN: 'jira-token',
			RESEND_API_KEY: 'resend-key'
		});
	});

	it('names a missing Resend API key', () => {
		for (const value of [undefined, '']) {
			const env = { ...TEST_ENV, DATA_DIR: '/data', RESEND_API_KEY: value };
			expect(() => loadConfig(env)).toThrow(/^Invalid environment variables:\nRESEND_API_KEY:/);
		}
	});

	it('names a missing Jira setting', () => {
		for (const name of ['JIRA_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'] as const) {
			const env: Record<string, string | undefined> = { ...TEST_ENV, DATA_DIR: '/data' };
			delete env[name];
			expect(() => loadConfig(env)).toThrow(
				new RegExp(`^Invalid environment variables:\\n${name}:`)
			);
		}
	});
});
