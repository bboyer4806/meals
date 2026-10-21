import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { TEST_ENV } from './testing.ts';

describe('loadConfig', () => {
	it('reads the settings', () => {
		expect(loadConfig({ ...TEST_ENV, DATA_DIR: '/data' })).toMatchObject({
			JIRA_URL: 'https://jira.example.com',
			JIRA_EMAIL: 'feedback@example.com',
			JIRA_API_TOKEN: 'jira-token'
		});
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
