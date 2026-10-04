import { defineConfig, devices } from '@playwright/test';

const port = 4173;

// Runs the production build with a throwaway database in .e2e-data. Tests sign in by writing a
// session straight into that database (tests/e2e/fixtures.ts), so the app needs no test login.
export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: '**/*.e2e.ts',
	fullyParallel: true,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		...devices['Pixel 7'],
		baseURL: `http://localhost:${port}`,
		trace: 'retain-on-failure',
		// Lets a machine with a different preinstalled Chromium run the tests.
		launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH }
	},
	webServer: {
		command: `rm -rf .e2e-data && mkdir .e2e-data && npm run build && npx vite preview --port ${port} --strictPort`,
		url: `http://localhost:${port}/healthz`,
		reuseExistingServer: false,
		timeout: 180_000,
		env: {
			GOOGLE_CLIENT_ID: 'e2e-client-id',
			GOOGLE_CLIENT_SECRET: 'e2e-client-secret',
			ADMIN_EMAIL: 'admin@example.com',
			DATA_DIR: '.e2e-data'
		}
	}
});
