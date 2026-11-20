import { chromium, type Browser, type Page } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Launches the real Obsidian app for end-to-end tests, isolated from the
 * user's own setup: a throwaway profile (--user-data-dir) and a throwaway
 * vault under .e2e-tmp/, with this plugin's build installed and enabled.
 * Nothing in the user's Obsidian profile or vaults is read or changed, except
 * that the newest downloaded Obsidian app package is copied in (read only), so
 * the test runs the same Obsidian version the user has.
 */

const PLUGIN_ID = 'novel-goal-tracker';
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function obsidianExecutable(): string {
	const candidates = [
		process.env.OBSIDIAN_PATH,
		'/Applications/Obsidian.app/Contents/MacOS/Obsidian',
		join(homedir(), 'Applications/Obsidian.app/Contents/MacOS/Obsidian'),
	].filter((p): p is string => Boolean(p));
	const found = candidates.find((p) => existsSync(p));
	if (!found) throw new Error('Obsidian not found. Set OBSIDIAN_PATH to the Obsidian executable.');
	return found;
}

/** The newest Obsidian app package the user's install has downloaded, if any. */
function newestAppPackage(): string | null {
	const dir = join(homedir(), 'Library/Application Support/obsidian');
	if (!existsSync(dir)) return null;
	const asars = readdirSync(dir)
		.filter((f) => /^obsidian-\d+\.\d+\.\d+\.asar$/.test(f))
		.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
	const last = asars.at(-1);
	return last ? join(dir, last) : null;
}

export interface TestVault {
	dir: string;
	vault: string;
	profile: string;
}

/** A fresh vault with the plugin installed, and a profile that opens it. */
export function createTestVault(name: string, files: Record<string, string> = {}): TestVault {
	const dir = join(ROOT, '.e2e-tmp', name);
	rmSync(dir, { recursive: true, force: true });
	const vault = join(dir, 'vault');
	const profile = join(dir, 'profile');
	const pluginDir = join(vault, '.obsidian', 'plugins', PLUGIN_ID);
	mkdirSync(pluginDir, { recursive: true });
	mkdirSync(profile, { recursive: true });
	for (const f of ['main.js', 'manifest.json', 'styles.css']) copyFileSync(join(ROOT, f), join(pluginDir, f));
	writeFileSync(join(vault, '.obsidian', 'community-plugins.json'), JSON.stringify([PLUGIN_ID]));
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(join(vault, path, '..'), { recursive: true });
		writeFileSync(join(vault, path), text);
	}
	// Open this vault directly, skipping the vault picker.
	writeFileSync(
		join(profile, 'obsidian.json'),
		JSON.stringify({ vaults: { e2etestvault0001: { path: vault, ts: Date.now(), open: true } }, updateDisabled: true }),
	);
	const pkg = newestAppPackage();
	if (pkg) copyFileSync(pkg, join(profile, pkg.split('/').pop() as string));
	return { dir, vault, profile };
}

/** A free local port for Obsidian's debugging connection. */
function freePort(): Promise<number> {
	return new Promise((res, rej) => {
		const srv = createServer();
		srv.unref();
		srv.on('error', rej);
		srv.listen(0, '127.0.0.1', () => {
			const addr = srv.address();
			const port = typeof addr === 'object' && addr ? addr.port : 0;
			srv.close(() => res(port));
		});
	});
}

export interface RunningObsidian {
	page: Page;
	/** Find the Obsidian window (main or pop-out, e.g. Settings) showing this text. */
	windowWith(text: string, timeoutMs?: number): Promise<Page>;
	close(): Promise<void>;
}

/**
 * Start Obsidian on the test vault and connect to it. Obsidian's Electron
 * build doesn't accept Node's --inspect flag (which Playwright's Electron
 * launcher needs), so we start it with a Chrome debugging port and connect
 * Playwright to that instead.
 */
export async function launchObsidian(v: TestVault): Promise<RunningObsidian> {
	// A test run that was cut off can leave Obsidian running on this profile.
	spawnSync('pkill', ['-f', `--user-data-dir=${v.profile}`]);
	const port = await freePort();
	const proc: ChildProcess = spawn(
		obsidianExecutable(),
		[`--user-data-dir=${v.profile}`, `--remote-debugging-port=${port}`, '--remote-allow-origins=*'],
		{ stdio: 'ignore', detached: false },
	);
	let browser: Browser | null = null;
	const deadline = Date.now() + 60_000;
	while (!browser) {
		try {
			browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
		} catch (e) {
			if (Date.now() > deadline) {
				proc.kill();
				throw e;
			}
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	const close = async (): Promise<void> => {
		await browser?.close().catch(() => {});
		// Quit Obsidian and wait for it (and its helpers) to exit.
		const exited = new Promise<void>((res) => proc.once('exit', () => res()));
		proc.kill('SIGTERM');
		await Promise.race([exited, new Promise((r) => setTimeout(r, 8000))]);
		spawnSync('pkill', ['-9', '-f', `--user-data-dir=${v.profile}`]);
	};
	try {
		// The vault window (not DevTools or a blank page).
		let page: Page | undefined;
		while (!page && Date.now() < deadline) {
			page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('app://'));
			if (!page) await new Promise((r) => setTimeout(r, 500));
		}
		if (!page) throw new Error('Obsidian window not found');
		await page.waitForLoadState('domcontentloaded');
		// Background windows barely repaint, which delays dialogs; keep the test window in front.
		await page.bringToFront();
		// A new vault with community plugins asks whether to trust it.
		const trust = page.getByRole('button', { name: /Trust author and enable plugins/i });
		try {
			await trust.click({ timeout: 15_000 });
		} catch {
			// Already trusted, or no prompt.
		}
		// Trusting the vault reloads the window; wait until the plugin is loaded
		// in a page that stays put.
		const loaded = (): Promise<unknown> =>
			page!.waitForFunction(
				(id) => {
					const w = window as unknown as { app?: { plugins?: { plugins?: Record<string, unknown> } } };
					return Boolean(w.app?.plugins?.plugins?.[id]);
				},
				PLUGIN_ID,
				{ timeout: 30_000 },
			);
		for (let attempt = 0; ; attempt++) {
			try {
				await loaded();
				await page.waitForTimeout(1500);
				await loaded();
				break;
			} catch (e) {
				if (attempt >= 3) throw e;
				await page.waitForTimeout(1000);
			}
		}
		const windowWith = async (text: string, timeoutMs = 15_000): Promise<Page> => {
			const until = Date.now() + timeoutMs;
			for (;;) {
				for (const p of browser!.contexts().flatMap((c) => c.pages())) {
					const has = await p.getByText(text, { exact: false }).first().isVisible().catch(() => false);
					if (has) return p;
				}
				if (Date.now() > until) throw new Error(`No Obsidian window shows "${text}"`);
				await new Promise((r) => setTimeout(r, 300));
			}
		};
		return { page, windowWith, close };
	} catch (e) {
		await close();
		throw e;
	}
}

/** Plugin data as saved to data.json, read through the running plugin. */
export async function pluginData(page: Page): Promise<Record<string, unknown>> {
	return page.evaluate((id) => {
		const w = window as unknown as { app: { plugins: { plugins: Record<string, { data: unknown }> } } };
		return JSON.parse(JSON.stringify(w.app.plugins.plugins[id]?.data)) as Record<string, unknown>;
	}, PLUGIN_ID);
}

/** Run an Obsidian command by id (e.g. "novel-goal-tracker:create-novel"). */
export async function runCommand(page: Page, id: string): Promise<void> {
	await page.evaluate((cmd) => {
		const w = window as unknown as { app: { commands: { executeCommandById(id: string): boolean } } };
		w.app.commands.executeCommandById(cmd);
	}, id);
}
