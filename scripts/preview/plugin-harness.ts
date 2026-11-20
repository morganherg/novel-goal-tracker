// Runs the real plugin (main.ts) against a fake vault in a browser page.
import './dom-shim';
import { TFile, TFolder } from './obsidian-browser-stub';
import Plugin from '../../src/main';

const files: Record<string, string> = (window as unknown as { __files: Record<string, string> }).__files;
const folders = new Map<string, TFolder>();
const fileObjs = new Map<string, TFile>();
for (const path of Object.keys(files)) {
	const f = new TFile(path);
	fileObjs.set(path, f);
	const parts = path.split('/');
	for (let i = 1; i < parts.length; i++) {
		const dir = parts.slice(0, i).join('/');
		if (!folders.has(dir)) folders.set(dir, new TFolder(dir));
	}
}
for (const [path, folder] of folders) {
	for (const [p, f] of [...fileObjs, ...folders]) {
		if (p !== path && p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/')) folder.children.push(f);
	}
}
const app = {
	vault: {
		on: () => ({}),
		getFolderByPath: (p: string) => folders.get(p) ?? null,
		getFileByPath: (p: string) => fileObjs.get(p) ?? null,
		getAbstractFileByPath: (p: string) => fileObjs.get(p) ?? folders.get(p) ?? null,
		cachedRead: async (f: TFile) => files[f.path] ?? '',
	},
	workspace: {
		onLayoutReady: (cb: () => void) => window.setTimeout(cb, 0),
		on: () => ({}),
		getLeavesOfType: () => [],
		getActiveFile: () => null,
		iterateAllLeaves: () => {},
	},
	loadLocalStorage: () => 'device-preview',
	saveLocalStorage: () => {},
};
const plugin = new Plugin(app as never, { id: 'novel-goal-tracker' } as never);
const out = document.getElementById('frame') as HTMLElement;
const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(String(e.error?.stack ?? e.message)));
(async () => {
	try {
		await plugin.onload();
		const h = (plugin as unknown as { handlers: Record<string, (s: string, el: HTMLElement, ctx: unknown) => void> }).handlers['novel-dashboard'];
		const el = out.createDiv();
		h?.('novel: ' + (window as unknown as { __novelId: string }).__novelId, el, {
			sourcePath: (window as unknown as { __dashPath: string }).__dashPath,
			addChild: (c: { onload: () => void }) => c.onload(),
		});
		await new Promise((r) => window.setTimeout(r, 300));
		const el2 = out.createDiv();
		h?.('novel: ' + (window as unknown as { __novelId: string }).__novelId, el2, {
			sourcePath: (window as unknown as { __dashPath: string }).__dashPath,
			addChild: (c: { onload: () => void }) => c.onload(),
		});
	} catch (e) {
		errors.push(String((e as Error).stack ?? e));
	}
	(window as unknown as { __errors: string[] }).__errors = errors;
	document.title = errors.length ? 'ERRORS' : 'OK';
})();
