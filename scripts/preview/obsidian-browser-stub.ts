// A browser stand-in for the 'obsidian' module, enough to run the real plugin
// in a page and catch rendering errors. Previews only.
export function normalizePath(p: string): string {
	return p.replace(/[\\/]+/g, '/').replace(/^\/+|\/+$/g, '') || '/';
}
export class TAbstractFile {
	constructor(public path: string) {}
	get name(): string {
		return this.path.split('/').pop() ?? '';
	}
}
export class TFile extends TAbstractFile {
	get extension(): string {
		return this.path.split('.').pop() ?? '';
	}
	get basename(): string {
		return this.name.replace(/\.[^.]*$/, '');
	}
}
export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
}
export class Vault {
	static recurseChildren(root: TFolder, cb: (f: TAbstractFile) => void): void {
		for (const c of root.children) {
			cb(c);
			if (c instanceof TFolder) Vault.recurseChildren(c, cb);
		}
	}
}
export class MarkdownView {}
export class App {}
export class Notice {
	constructor(msg: string) {
		console.log('Notice:', msg);
	}
}
export class Component {
	private cleanups: (() => void)[] = [];
	addChild<T extends { onload?: () => void }>(c: T): T {
		c.onload?.();
		return c;
	}
	register(cb: () => void): void {
		this.cleanups.push(cb);
	}
	registerEvent(): void {}
	registerInterval(i: number): number {
		return i;
	}
	registerDomEvent(): void {}
}
export class MarkdownRenderChild extends Component {
	constructor(public containerEl: HTMLElement) {
		super();
	}
}
export class Plugin extends Component {
	handlers: Record<string, (s: string, el: HTMLElement, ctx: unknown) => void> = {};
	constructor(
		public app: unknown,
		public manifest: unknown,
	) {
		super();
	}
	async loadData(): Promise<unknown> {
		return (window as unknown as { __data: unknown }).__data;
	}
	async saveData(d: unknown): Promise<void> {
		console.log('saveData', d);
	}
	addSettingTab(): void {}
	addCommand(): void {}
	addRibbonIcon(): void {}
	addStatusBarItem(): HTMLElement {
		return document.createElement('div');
	}
	registerView(): void {}
	registerEditorExtension(): void {}
	registerMarkdownCodeBlockProcessor(lang: string, h: (s: string, el: HTMLElement, ctx: unknown) => void): void {
		this.handlers[lang] = h;
	}
}
export class PluginSettingTab {}
export class Modal {}
export class FuzzySuggestModal {}
export class ItemView {}
export class Setting {}
export const editorInfoField = {};
export function debounce<T extends unknown[]>(cb: (...a: T) => void, ms = 0) {
	let t: number | undefined;
	let args: T | null = null;
	const d = (...a: T) => {
		args = a;
		if (t === undefined) t = window.setTimeout(() => d.run(), ms);
		return d;
	};
	d.run = () => {
		window.clearTimeout(t);
		t = undefined;
		if (args) {
			const a = args;
			args = null;
			cb(...a);
		}
	};
	d.cancel = () => {
		window.clearTimeout(t);
		t = undefined;
		args = null;
		return d;
	};
	return d;
}

export function requireApiVersion(): boolean {
	return true;
}

export class ExtraButtonComponent {}

export class Menu {
	addItem(): this {
		return this;
	}
	addSeparator(): this {
		return this;
	}
	showAtMouseEvent(): void {}
}
