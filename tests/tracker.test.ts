import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MarkdownView, TFile } from './obsidian-stub';
import { Tracker, type DocView } from '../src/tracker';
import type { Novel } from '../src/types';

(globalThis as { window?: unknown }).window ??= globalThis;

const novel: Novel = {
	id: 'n1', title: 'Storm', summary: '', genre: '', goal: 50000,
	startDate: '2026-11-01', endDate: '2026-11-30', folderPath: 'Storm', createdAt: '', updatedAt: '',
};
const CH1 = 'Storm/Chapters/Chapter 1.md';
const CH2 = 'Storm/Chapters/Chapter 2.md';

/** A fake CodeMirror editor showing one file. */
class FakeView implements DocView {
	text: string;
	state = { doc: { toString: () => this.text } };
	constructor(public path: string | null, text: string) {
		this.text = text;
	}
}

function setup(files: Record<string, string>, rules: { code?: boolean } = {}, slow?: Promise<void>) {
	const disk = new Map(Object.entries(files));
	const typed: number[] = [];
	const opts = { ...rules };
	const markdownViews: MarkdownView[] = [];
	const app = {
		vault: {
			cachedRead: async (f: TFile) => {
				if (slow && f.path === CH2) await slow; // lets tests act while a scan is running
				return disk.get(f.path) ?? '';
			},
		},
		workspace: { getLeavesOfType: () => markdownViews.map((view) => ({ view })) },
	};
	const tracker = new Tracker(app as never, {
		novels: () => [novel],
		countRules: () => opts,
		chapterFiles: () => [...disk.keys()].filter((p) => p.startsWith('Storm/Chapters/')).map((p) => new TFile(p) as never),
		onTyped: (_n, d) => typed.push(d),
		onCountsChanged: () => {},
	});
	/** Open a file in an editor. */
	const open = (path: string) => {
		const v = new FakeView(path, disk.get(path) ?? '');
		tracker.trackView(v, path);
		markdownViews.push(new MarkdownView(new TFile(path), { getValue: () => v.text }));
		return v;
	};
	/** Change an editor's text, tagged as typing or not. */
	const edit = (v: FakeView, text: string, user: boolean, now?: number) => {
		const before = v.text;
		v.text = text;
		tracker.onEditorUpdate(v, v.path, { toString: () => before }, { toString: () => text }, user, now);
	};
	return { tracker, disk, typed, open, edit, opts };
}

test('initial scan counts existing text without crediting today', async () => {
	const { tracker, typed } = setup({ [CH1]: 'one two three', [CH2]: 'four five', 'Other/x.md': 'not here' });
	await tracker.scanAll();
	assert.equal(tracker.novelWords(novel), 5);
	assert.deepEqual(typed, []);
});

test('typing counts as net words', async () => {
	const { tracker, typed, open, edit } = setup({ [CH1]: 'one two three' });
	await tracker.scanAll();
	const v = open(CH1);
	edit(v, 'one two three four five', true);
	tracker.flush();
	edit(v, 'one two three four', true);
	tracker.flush();
	assert.deepEqual(typed, [2, -1]);
	assert.equal(tracker.novelWords(novel), 4);
});

test('typing outside Chapters is ignored', async () => {
	const { tracker, typed, open, edit } = setup({ [CH1]: 'a', 'Storm/Dashboard.md': '' });
	await tracker.scanAll();
	const v = open('Storm/Dashboard.md');
	edit(v, 'lots of words here', true);
	tracker.flush();
	assert.deepEqual(typed, []);
});

test('a reload after sync is not credited, even with typing waiting', async () => {
	const { tracker, typed, open, edit } = setup({ [CH1]: 'a b' });
	await tracker.scanAll();
	const v = open(CH1);
	edit(v, 'a b c', true); // one word typed, still waiting
	edit(v, 'a b c x y z w', false); // sync reload arrives before the wait ends
	tracker.flush();
	assert.deepEqual(typed, [1]);
	assert.equal(tracker.novelWords(novel), 7);
	edit(v, 'a b c x y z w v', true); // typing right after the reload
	tracker.flush();
	assert.deepEqual(typed, [1, 1]);
});

test('a plugin inserting text is not credited', async () => {
	const { tracker, typed, open, edit } = setup({ [CH1]: '' });
	await tracker.scanAll();
	const v = open(CH1);
	edit(v, 'Template heading and lots of boilerplate', false);
	assert.deepEqual(typed, []);
});

test('paste and drop count even if the editor does not tag them', async () => {
	const { tracker, typed, open, edit } = setup({ [CH1]: 'a' });
	await tracker.scanAll();
	const v = open(CH1);
	tracker.markUserInsert(CH1, 1000);
	edit(v, 'a b c d', false, 1500);
	tracker.flush();
	assert.deepEqual(typed, [3]);
	edit(v, 'a b c d e f', false, 5000); // long after: not the paste
	assert.deepEqual(typed, [3]);
});

test('a synced change to a closed file updates the total but not today', async () => {
	const { tracker, typed, disk } = setup({ [CH1]: 'a b' });
	await tracker.scanAll();
	disk.set(CH1, 'a b c d e f g');
	await tracker.onModify(new TFile(CH1) as never);
	assert.deepEqual(typed, []);
	assert.equal(tracker.novelWords(novel), 7);
});

test('a file that was open and then closed takes synced changes from disk', async () => {
	const { tracker, typed, disk, open, edit } = setup({ [CH1]: 'a b' });
	await tracker.scanAll();
	const v = open(CH1);
	edit(v, 'a b c', true);
	tracker.onViewClosed(v);
	assert.deepEqual(typed, [1], 'typing counted on close');
	disk.set(CH1, 'a b c d e');
	(tracker as unknown as { app: { workspace: { getLeavesOfType: () => unknown[] } } }).app.workspace.getLeavesOfType = () => [];
	await tracker.onModify(new TFile(CH1) as never);
	assert.equal(tracker.novelWords(novel), 5);
	assert.deepEqual(typed, [1]);
});

test('switching an editor to another file never mixes up their counts', async () => {
	const { tracker, typed, open, edit } = setup({ [CH1]: 'a b c d', [CH2]: 'x' });
	await tracker.scanAll();
	const v = open(CH1);
	edit(v, 'a b c d e', true); // typed in chapter 1, waiting
	v.path = CH2;
	edit(v, 'x', false); // Obsidian loads chapter 2 into the same editor
	tracker.flush();
	assert.deepEqual(typed, [1]);
	assert.equal(tracker.chapterWords(CH1), 5);
	assert.equal(tracker.chapterWords(CH2), 1);
});

test('two panes on one file never double count', async () => {
	const { tracker, typed, open, edit } = setup({ [CH1]: 'a' });
	await tracker.scanAll();
	const a = open(CH1);
	const b = open(CH1);
	edit(a, 'a b c', true);
	edit(b, 'a b c', false); // mirrored into the other pane, untagged
	edit(b, 'a b c d', true);
	edit(a, 'a b c d', true); // or mirrored with a tag
	tracker.flush();
	assert.equal(typed.reduce((s, d) => s + d, 0), 3);
	assert.equal(tracker.novelWords(novel), 4);
});

test('moving text between chapters nets zero', async () => {
	const { tracker, typed, open, edit } = setup({ [CH1]: 'a b c d', [CH2]: 'x' });
	await tracker.scanAll();
	const e1 = open(CH1);
	const e2 = open(CH2);
	edit(e1, 'a b', true);
	edit(e2, 'x c d', true);
	tracker.flush();
	assert.equal(typed.reduce((s, d) => s + d, 0), 0);
});

test('typing during the first scan is credited once it finishes', async () => {
	const { tracker, typed, open, edit } = setup({ [CH1]: 'a b' });
	const v = open(CH1);
	const scan = tracker.scanAll();
	edit(v, 'a b c d', true);
	tracker.flush();
	await scan;
	assert.deepEqual(typed, [2]);
});

test('changing a counting rule never credits the difference', async () => {
	const { tracker, typed, open, edit, opts } = setup({ [CH1]: 'words\n```\ncode code code\n```' });
	await tracker.scanAll();
	const v = open(CH1);
	edit(v, 'words more\n```\ncode code code\n```', true);
	tracker.flush();
	opts.code = true;
	await tracker.rescan();
	edit(v, 'words more again\n```\ncode code code\n```', true);
	tracker.flush();
	assert.deepEqual(typed, [1, 1]);
	assert.equal(tracker.novelWords(novel), 6);
});

test('rename keeps counts; moving out of Chapters drops them; delete forgets', async () => {
	const { tracker, disk } = setup({ [CH1]: 'a b c', [CH2]: 'd' });
	await tracker.scanAll();
	const moved = 'Storm/Chapters/Part 1/Chapter 1.md';
	disk.set(moved, 'a b c');
	await tracker.onRename(new TFile(moved) as never, CH1);
	assert.equal(tracker.chapterWords(moved), 3);
	await tracker.onRename(new TFile('Storm/Notes.md') as never, moved);
	assert.equal(tracker.novelWords(novel), 1);
	tracker.onDelete(CH2);
	assert.equal(tracker.novelWords(novel), 0);
});

function gate() {
	let open!: () => void;
	const p = new Promise<void>((r) => (open = r));
	return { p, open };
}

test('a sync reload during a scan moves the baseline instead of being credited later', async () => {
	const g = gate();
	const { tracker, typed, open, edit } = setup({ [CH1]: 'a b', [CH2]: 'z' }, {}, g.p);
	const v = open(CH1);
	const scan = tracker.scanAll();
	await Promise.resolve();
	edit(v, 'a b x y z w', false); // reload arrives mid-scan
	g.open();
	await scan;
	edit(v, 'a b x y z w v', true);
	tracker.flush();
	assert.deepEqual(typed, [1]);
});

test('typing then a reload during a scan credits only the typing', async () => {
	const g = gate();
	const { tracker, typed, open, edit } = setup({ [CH1]: 'a b', [CH2]: 'z' }, {}, g.p);
	const v = open(CH1);
	const scan = tracker.scanAll();
	await Promise.resolve();
	edit(v, 'a b c', true);
	edit(v, 'a b c x y z', false);
	g.open();
	await scan;
	tracker.flush();
	assert.deepEqual(typed, [1]);
	assert.equal(tracker.chapterWords(CH1), 6);
});

test('typing saved to disk before the scan reaches the file is still credited', async () => {
	const g = gate();
	const { tracker, typed, open, edit, disk } = setup({ [CH2]: 'z', ['Storm/Chapters/Chapter 3.md']: 'a b' }, {}, g.p);
	const CH3 = 'Storm/Chapters/Chapter 3.md';
	const v = open(CH3);
	const scan = tracker.scanAll();
	await Promise.resolve();
	edit(v, 'a b c d', true);
	tracker.flush();
	disk.set(CH3, 'a b c d'); // autosaved before the scan reads it
	g.open();
	await scan;
	assert.deepEqual(typed, [2]);
	assert.equal(tracker.chapterWords(CH3), 4);
});

test('typing during a recount is credited once, under the new rules', async () => {
	const g = gate();
	const { tracker, typed, open, edit, opts } = setup({ [CH1]: 'words', [CH2]: 'z' }, {}, g.p);
	await (async () => { g.open(); await tracker.scanAll(); })();
	const g2 = gate();
	(tracker as unknown as { app: { vault: { cachedRead: (f: TFile) => Promise<string> } } }).app.vault.cachedRead = async (f) => {
		if (f.path === CH2) await g2.p;
		return f.path === CH2 ? 'z' : 'words';
	};
	const v = open(CH1);
	opts.code = true;
	const re = tracker.rescan();
	await Promise.resolve();
	edit(v, 'words and more', true);
	tracker.flush();
	g2.open();
	await re;
	assert.deepEqual(typed, [2]);
	assert.equal(tracker.novelWords(novel), 4);
});

test('a chapter deleted during a scan does not come back', async () => {
	const g = gate();
	const { tracker } = setup({ [CH1]: 'a b c', [CH2]: 'z' }, {}, g.p);
	const scan = tracker.scanAll();
	await Promise.resolve();
	tracker.onDelete(CH1);
	g.open();
	await scan;
	assert.equal(tracker.chapterWords(CH1), undefined);
});

test('typing waiting when a scan reads the open editor is still credited', async () => {
	const g = gate();
	const { tracker, typed, open, edit } = setup({ [CH2]: 'x', [CH1]: 'a b' }, {}, g.p);
	const v = open(CH1);
	const scan = tracker.scanAll(true);
	await Promise.resolve();
	edit(v, 'a b c d e', true); // waiting, not yet counted
	g.open();
	await scan; // the scan read the editor text, typing included
	tracker.flush();
	assert.deepEqual(typed, [3]);
	assert.equal(tracker.chapterWords(CH1), 5);
});

test('renaming a chapter with typing waiting credits that typing', async () => {
	const { tracker, typed, open, edit, disk } = setup({ [CH1]: 'a b' });
	await tracker.scanAll();
	const v = open(CH1);
	edit(v, 'a b c', true);
	disk.set('Elsewhere/Chapter 1.md', 'a b c');
	await tracker.onRename(new TFile('Elsewhere/Chapter 1.md') as never, CH1);
	assert.deepEqual(typed, [1]);
});

test('cut and paste between chapters nets zero even when untagged', async () => {
	const { tracker, typed, open, edit } = setup({ [CH1]: 'a b c d', [CH2]: 'x' });
	await tracker.scanAll();
	const e1 = open(CH1);
	const e2 = open(CH2);
	tracker.markUserInsert(CH1, 1000);
	edit(e1, 'a b', false, 1100); // Obsidian applies the cut without a tag
	tracker.markUserInsert(CH2, 2000);
	edit(e2, 'x c d', false, 2100); // and the paste
	tracker.flush();
	assert.deepEqual(typed, [-2, 2]);
});
