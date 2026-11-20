// Minimal stand-in for the parts of the 'obsidian' module used in tests.
export function normalizePath(path: string): string {
	return path.replace(/[\\/]+/g, '/').replace(/^\/+|\/+$/g, '') || '/';
}
export class TFile {
	constructor(public path = '') {}
	get extension(): string {
		return this.path.split('.').pop() ?? '';
	}
}
export class App {}
export class MarkdownView {
	constructor(
		public file: TFile | null,
		public editor: { getValue(): string },
	) {}
}

type Fn<T extends unknown[]> = (...args: T) => void;
/** Like Obsidian's debounce, but only fires on run() so tests stay synchronous. */
export function debounce<T extends unknown[]>(cb: Fn<T>) {
	let args: T | null = null;
	const d = (...a: T) => {
		args = a;
		return d;
	};
	d.run = () => {
		if (args) {
			const a = args;
			args = null;
			cb(...a);
		}
	};
	d.cancel = () => {
		args = null;
		return d;
	};
	return d;
}
