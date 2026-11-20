import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboardMarkdown, folderNameFromTitle, nextChapterName, novelFolderPath, parseDashboardSource } from '../src/novel-folder';
import type { Novel } from '../src/types';

test('titles become safe folder names', () => {
	assert.equal(folderNameFromTitle('The Storm: Part 1'), 'The Storm Part 1');
	assert.equal(folderNameFromTitle('  Who/What?  '), 'WhoWhat');
	assert.equal(folderNameFromTitle('...hidden'), 'hidden');
	assert.equal(folderNameFromTitle('Ends.'), 'Ends');
	assert.equal(folderNameFromTitle('#[]^|'), '');
	assert.equal(folderNameFromTitle('Ünïcode 小説'), 'Ünïcode 小説');
	assert.equal(folderNameFromTitle('. . .'), '');
	assert.equal(folderNameFromTitle('. .Storm'), 'Storm');
	assert.equal(folderNameFromTitle(' .. Storm .. '), 'Storm');
});

test('long titles are cut without a trailing space or dot', () => {
	assert.equal(folderNameFromTitle('A'.repeat(119) + ' x'), 'A'.repeat(119));
	assert.equal(folderNameFromTitle('A'.repeat(119) + '.x'), 'A'.repeat(119));
	const emoji = folderNameFromTitle('😀'.repeat(130));
	assert.equal(Array.from(emoji).length, 120);
	assert.ok(!emoji.endsWith('\uD83D'), 'must not split a surrogate pair');
});

test('novel folder path respects the parent folder', () => {
	assert.equal(novelFolderPath('Storm', ''), 'Storm');
	assert.equal(novelFolderPath('Storm', 'Novels/'), 'Novels/Storm');
	assert.equal(novelFolderPath('Storm', '/Writing/Novels'), 'Writing/Novels/Storm');
});

test('dashboard block round-trips the novel id', () => {
	const md = dashboardMarkdown({ id: 'k3x9' } as Novel);
	const lines = md.split('\n');
	assert.ok(!lines[0]?.startsWith('```'), 'block must not be on the first line');
	const open = lines.findIndex((l) => l.startsWith('```novel-dashboard'));
	const inner = lines.slice(open + 1, lines.indexOf('```', open + 1)).join('\n');
	assert.deepEqual(parseDashboardSource(inner), { novelId: 'k3x9' });
	assert.deepEqual(parseDashboardSource(''), { novelId: null });
});

test('next chapter name skips names already used', () => {
	assert.equal(nextChapterName([]), 'Chapter 1');
	assert.equal(nextChapterName(['Chapter 1']), 'Chapter 2');
	assert.equal(nextChapterName(['Prologue', 'chapter 3']), 'Chapter 4');
	assert.equal(nextChapterName(['Chapter 1', 'Chapter 2', 'Notes']), 'Chapter 4');
});
