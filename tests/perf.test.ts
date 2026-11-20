import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TFile } from './obsidian-stub';
import { Tracker, type DocView } from '../src/tracker';
import { addDays } from '../src/dates';
import { countWords } from '../src/count';
import { computeStats, dailyTotals, emptyDevice, hourTotals, recordDelta, type History } from '../src/history';
import { progressSeries } from '../src/series';
import type { Novel } from '../src/types';

(globalThis as { window?: unknown }).window ??= globalThis;

// A 150,000-word novel: 30 chapters of 5,000 words of ordinary Markdown prose.
const para =
	'She walked down to the *harbour* before dawn, where the boats knocked together like "old friends". ' +
	'Nobody else was awake; the lamps were still lit, and the gulls hadn’t started yet.\n\n';
const wordsPerPara = countWords(para);
const chapterText = '# Chapter\n\n' + para.repeat(Math.ceil(5000 / wordsPerPara));
const novel: Novel = {
	id: 'big', title: 'Big', summary: '', genre: '', goal: 150000,
	startDate: '2026-01-01', endDate: '2026-12-31', folderPath: 'Big', createdAt: '', updatedAt: '',
};

function time(fn: () => void, runs = 5): number {
	const t0 = performance.now();
	for (let i = 0; i < runs; i++) fn();
	return (performance.now() - t0) / runs;
}

test('150k-word novel: first scan, typing, and dashboard math stay fast', async () => {
	const files = new Map<string, string>();
	for (let i = 1; i <= 30; i++) files.set(`Big/Chapters/Chapter ${i}.md`, chapterText);
	const app = {
		vault: { cachedRead: async (f: TFile) => files.get(f.path) ?? '' },
		workspace: { getLeavesOfType: () => [] },
	};
	const tracker = new Tracker(app as never, {
		novels: () => [novel],
		countRules: () => ({}),
		chapterFiles: () => [...files.keys()].map((p) => new TFile(p) as never),
		onTyped: () => {},
		onCountsChanged: () => {},
	});

	const t0 = performance.now();
	await tracker.scanAll();
	const scanMs = performance.now() - t0;
	const total = tracker.novelWords(novel);
	assert.ok(total >= 150000, `total ${total}`);

	// Typing: each update recounts only the edited chapter.
	const path = 'Big/Chapters/Chapter 1.md';
	let text = chapterText;
	const view: DocView = { state: { doc: { toString: () => text } } };
	tracker.trackView(view, path);
	const typingMs = time(() => {
		const before = text;
		text += ' more';
		tracker.onEditorUpdate(view, path, { toString: () => before }, { toString: () => text }, true);
		tracker.flush();
	}, 50);

	// A full year of history from three devices.
	const history: History = { a: emptyDevice(), b: emptyDevice(), c: emptyDevice() };
	for (let d = 0; d < 365; d++) {
		for (const dev of Object.values(history)) {
			for (let h = 0; h < 6; h++) recordDelta(dev, novel.id, addDays('2026-01-01', d), (h * 4) % 24, 80, 't');
		}
	}
	const dashMs = time(() => {
		const typed = dailyTotals(history, novel.id);
		const net = dailyTotals(history, novel.id, 'net');
		const stats = computeStats(novel, '2026-11-20', total, typed);
		progressSeries(novel, '2026-11-20', stats.current, net, typed);
		hourTotals(history, novel.id);
	}, 20);

	console.log(`  scan ${scanMs.toFixed(0)} ms, typing update ${typingMs.toFixed(1)} ms, dashboard math ${dashMs.toFixed(1)} ms`);
	assert.ok(scanMs < 2000, `first scan took ${scanMs.toFixed(0)} ms`);
	assert.ok(typingMs < 16, `a typing update took ${typingMs.toFixed(1)} ms (one frame is 16 ms)`);
	assert.ok(dashMs < 50, `dashboard math took ${dashMs.toFixed(1)} ms`);
});
