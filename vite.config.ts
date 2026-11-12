import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Runes mode everywhere except in dependencies.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			// The commit the image is built from (Dockerfile), which /healthz answers with (4.2).
			// Other builds, such as a local one, get SvelteKit's default: the time they were built.
			version: { name: process.env.COMMIT },
			// Turns off SvelteKit's check of where forms come from, which can't leave out OAuth's
			// token endpoint. hooks.server.ts makes the same check without it (origin.ts, 4.5).
			csrf: { trustedOrigins: ['*'] },
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'data:'],
					'font-src': ['self'],
					'connect-src': ['self'],
					// Allow and Deny on an AI assistant's connection page send the admin back to
					// ChatGPT or Claude (design 6.17), and a browser checks that redirect too. The
					// same sites as ASSISTANT_ORIGINS in src/lib/server/auth/oauth.ts.
					'form-action': [
						'self',
						'https://chatgpt.com',
						'https://platform.openai.com',
						'https://claude.ai',
						'https://claude.com'
					],
					'frame-ancestors': ['none'],
					'base-uri': ['self'],
					'object-src': ['none']
				}
			}
		})
	],
	test: {
		include: ['src/**/*.spec.ts', 'scripts/**/*.spec.ts'],
		environment: 'node',
		expect: { requireAssertions: true }
	}
});
