import { defineConfig } from '@playwright/test';

/**
 * Two kinds of end-to-end tests:
 * - browser:  the real dashboard and plugin code in headless Chromium, with a
 *             stand-in for Obsidian. Fast; runs anywhere, including CI.
 * - obsidian: the real Obsidian app, launched with a throwaway vault and
 *             profile. Opens Obsidian windows; run on purpose with
 *             `npm run test:obsidian`.
 */
export default defineConfig({
	timeout: 30_000,
	reporter: [['list']],
	projects: [
		{
			name: 'browser',
			testDir: 'e2e/browser',
			use: { baseURL: 'http://127.0.0.1:8766', browserName: 'chromium', headless: true },
		},
		{
			name: 'obsidian',
			testDir: 'e2e/obsidian',
			timeout: 120_000,
			retries: 0,
			workers: 1,
		},
	],
	webServer: {
		command: 'npm run preview && node scripts/preview/serve.mjs 8766',
		url: 'http://127.0.0.1:8766/scripts/preview/index.html',
		reuseExistingServer: true,
		timeout: 60_000,
	},
});
