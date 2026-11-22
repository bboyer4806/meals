import { defineConfig, devices } from '@playwright/test';

const port = 4173;
// The stand-in Jira's port, also in tests/e2e/fixtures.ts.
const jiraPort = 4174;
// The port the image answers on, behind tests/e2e/proxy.ts on `port`.
const imagePort = 4175;
// The commit the app says it's built from: the image's when CI sets COMMIT, otherwise the one the
// build here is given. Also in tests/e2e/healthz.e2e.ts.
const commit = process.env.COMMIT ?? 'e2e-commit';
// The Docker image to test instead of a build made here. CI sets it to the image it builds, which
// main then deploys, so the tests check the server production runs (MEA-105).
const image = process.env.E2E_IMAGE;

// The settings the app reads when it starts (README, "Settings"), but DATA_DIR.
const settings = {
	GOOGLE_CLIENT_ID: 'e2e-client-id',
	GOOGLE_CLIENT_SECRET: 'e2e-client-secret',
	ADMIN_EMAIL: 'admin@example.com',
	JIRA_URL: `http://localhost:${jiraPort}`,
	JIRA_EMAIL: 'feedback@example.com',
	JIRA_API_TOKEN: 'e2e-jira-token',
	// Never sent: the browser tests answer the actions that send email themselves.
	RESEND_API_KEY: 'e2e-resend-key'
};

// The image shares this machine's network, so it reaches the stand-in Jira at the same address.
// Its DATA_DIR is .e2e-data, mounted at /data. adapter-node takes every request as https, as
// production's come through nginx (design 4.3), unless the header PROTOCOL_HEADER names says
// otherwise, which tests/e2e/proxy.ts sends.
const imageEnv = {
	...settings,
	DATA_DIR: '/data',
	PORT: String(imagePort),
	PROTOCOL_HEADER: 'x-forwarded-proto'
};

// Runs the production build, or the image behind a stand-in for nginx, with a throwaway database
// in .e2e-data. Tests sign in by writing a session straight into that database
// (tests/e2e/fixtures.ts), so the app needs no test login. Feedback goes to a stand-in Jira
// (tests/e2e/jira-stub.ts).
export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: '**/*.e2e.ts',
	fullyParallel: true,
	// A test.only left in fails CI instead of skipping the other tests (design section 10).
	forbidOnly: !!process.env.CI,
	// CLAUDECODE is set in Claude Code's shell; dot keeps passing tests out of its context.
	reporter: process.env.CI ? 'github' : process.env.CLAUDECODE ? 'dot' : 'list',
	use: {
		...devices['Pixel 7'],
		baseURL: `http://localhost:${port}`,
		trace: 'retain-on-failure',
		// Lets a machine with a different preinstalled Chromium run the tests.
		launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH }
	},
	webServer: [
		{
			command: 'node tests/e2e/jira-stub.ts',
			url: `http://localhost:${jiraPort}/tickets`,
			reuseExistingServer: false,
			env: { PORT: String(jiraPort) }
		},
		...(image
			? [
					{
						// The image as production runs it, but as this machine's user, so the tests can
						// write the database and photos the app makes. `--env NAME` passes on NAME's
						// value from env. The image must already be built or loaded here.
						command: [
							'rm -rf .e2e-data && mkdir .e2e-data && docker run --rm --pull never --network host',
							'--user "$(id -u):$(id -g)" --volume "$(pwd)/.e2e-data:/data"',
							...Object.keys(imageEnv).map((name) => `--env ${name}`),
							image
						].join(' '),
						url: `http://localhost:${imagePort}/healthz`,
						reuseExistingServer: false,
						timeout: 180_000,
						env: imageEnv,
						// Docker stops the container on SIGTERM. The default, SIGKILL, would leave it
						// running.
						gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 10_000 }
					},
					{
						command: 'node tests/e2e/proxy.ts',
						url: `http://localhost:${port}/healthz`,
						reuseExistingServer: false,
						env: { PORT: String(port), TARGET_PORT: String(imagePort) }
					}
				]
			: [
					{
						command: `rm -rf .e2e-data && mkdir .e2e-data && npm run build && npx vite preview --port ${port} --strictPort`,
						url: `http://localhost:${port}/healthz`,
						reuseExistingServer: false,
						timeout: 180_000,
						env: { ...settings, COMMIT: commit, DATA_DIR: '.e2e-data' }
					}
				])
	]
});
