import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFolderRename, laterStamp, mergeForSave, normalizeData } from '../src/data';
import { DEFAULT_DATA, type Novel } from '../src/types';

const novel = (over: Partial<Novel> = {}): Novel => ({
	id: 'abc',
	title: 'Storm',
	summary: '',
	genre: '',
	goal: 50000,
	startDate: '2026-11-01',
	endDate: '2026-11-30',
	folderPath: 'Storm',
	createdAt: '',
	updatedAt: '',
	...over,
});

test('missing data gives defaults', () => {
	assert.deepEqual(normalizeData(null), DEFAULT_DATA);
	assert.deepEqual(normalizeData('garbage'), DEFAULT_DATA);
	assert.notEqual(normalizeData(null).novels, DEFAULT_DATA.novels, 'defaults must not be shared');
});

test('invalid novels are dropped, valid ones kept', () => {
	const data = normalizeData({
		hasOnboarded: true,
		dayStartHour: 4,
		novels: [novel(), { id: 'bad' }, novel({ id: 'x', goal: -5 }), novel({ id: 'y', endDate: '2026-02-30' })],
	});
	assert.equal(data.hasOnboarded, true);
	assert.equal(data.dayStartHour, 4);
	assert.deepEqual(data.novels.map((n) => n.id), ['abc']);
});

test('out-of-range day start hour falls back to midnight', () => {
	assert.equal(normalizeData({ dayStartHour: 30 }).dayStartHour, 0);
	assert.equal(normalizeData({ dayStartHour: 2.5 }).dayStartHour, 0);
});

test('folder renames update novel paths', () => {
	const novels = [novel({ folderPath: 'Novels/Storm' }), novel({ id: 'b', folderPath: 'Storm 2' })];
	assert.ok(applyFolderRename(novels, 'Novels', 'Writing'));
	assert.equal(novels[0]?.folderPath, 'Writing/Storm');
	assert.equal(novels[1]?.folderPath, 'Storm 2');
	assert.ok(applyFolderRename(novels, 'Storm 2', 'Calm'));
	assert.equal(novels[1]?.folderPath, 'Calm');
	assert.ok(!applyFolderRename(novels, 'Stor', 'X'), 'prefix of a name must not match');
});

test('history is normalized and bad entries dropped', () => {
	const data = normalizeData({
		history: {
			devA: {
				days: { n1: { '2026-11-19': { net: 120, hours: { '9': 100, '21': 20, '25': 5, x: 1 } }, bad: { net: 1 } } },
				adjustments: [{ id: 'a1', novelId: 'n1', date: '2026-11-18', words: 500 }, { id: 'a2' }],
				deletedAdjustments: ['zz', 4],
			},
			devB: 'nonsense',
		},
	});
	assert.deepEqual(Object.keys(data.history), ['devA']);
	assert.deepEqual(data.history.devA?.days.n1, { '2026-11-19': { net: 120, added: 120, hours: { '9': 100, '21': 20 } } });
	assert.equal(data.history.devA?.adjustments.length, 1);
	assert.deepEqual(data.history.devA?.deletedAdjustments, ['zz']);
});

test('saving keeps other devices’ history from disk', () => {
	const mem = normalizeData({ novels: [novel()], history: { me: { days: { abc: { '2026-11-19': { net: 10, hours: {} } } } }, other: { days: {} } } });
	const disk = normalizeData({ novels: [novel()], history: { me: { days: {} }, other: { days: { abc: { '2026-11-19': { net: 99, hours: {} } } } } } });
	const merged = mergeForSave(mem, disk, 'me');
	assert.equal(merged.history.me?.days.abc?.['2026-11-19']?.net, 10, 'my entry from memory');
	assert.equal(merged.history.other?.days.abc?.['2026-11-19']?.net, 99, 'other entry from disk');
});

test('novels created on another device are added; removed ones stay removed', () => {
	const mem = normalizeData({ novels: [novel({ id: 'a' }), novel({ id: 'b' })], removedNovelIds: ['c'] });
	const disk = normalizeData({ novels: [novel({ id: 'a' }), novel({ id: 'c' }), novel({ id: 'd' })], removedNovelIds: ['b'] });
	const merged = mergeForSave(mem, disk, 'me');
	assert.deepEqual(merged.novels.map((n) => n.id), ['a', 'd']);
	assert.deepEqual(Object.keys(merged.removedNovels).sort(), ['b', 'c']);
});

test('the most recently changed settings win on sync', () => {
	const mem = normalizeData({ dayStartHour: 0, settingsUpdatedAt: '2026-11-19T10:00:00.000Z' });
	const disk = normalizeData({ dayStartHour: 4, countOptions: { code: true }, settingsUpdatedAt: '2026-11-19T11:00:00.000Z' });
	const merged = mergeForSave(mem, disk, 'me');
	assert.equal(merged.dayStartHour, 4);
	assert.equal(merged.countOptions.code, true);
	const newerMem = normalizeData({ dayStartHour: 2, settingsUpdatedAt: '2026-11-19T12:00:00.000Z' });
	assert.equal(mergeForSave(newerMem, disk, 'me').dayStartHour, 2);
});

test('a folder rename on another device wins over the stale copy here', () => {
	const mem = normalizeData({ novels: [novel({ folderPath: 'Storm', updatedAt: '2026-11-19T10:00:00.000Z' })] });
	const disk = normalizeData({ novels: [novel({ folderPath: 'Storm (Draft)', updatedAt: '2026-11-19T11:00:00.000Z' })] });
	assert.equal(mergeForSave(mem, disk, 'me').novels[0]?.folderPath, 'Storm (Draft)');
	const renamedHere = normalizeData({ novels: [novel({ folderPath: 'Storm', updatedAt: '2026-11-19T10:00:00.000Z' })] });
	assert.ok(applyFolderRename(renamedHere.novels, 'Storm', 'Calm', '2026-11-19T12:00:00.000Z'));
	assert.equal(mergeForSave(renamedHere, disk, 'me').novels[0]?.folderPath, 'Calm');
});

test('older data without a settings stamp is not overwritten by a fresh device', () => {
	const fresh = normalizeData(null);
	const old = normalizeData({ dayStartHour: 4, novelsFolder: 'Novels', countOptions: { code: true } });
	const merged = mergeForSave(fresh, old, 'me', true);
	assert.equal(merged.dayStartHour, 4);
	assert.equal(merged.novelsFolder, 'Novels');
	assert.equal(merged.countOptions.code, true);
});

test('a local change wins even when another device clock runs ahead', () => {
	const ahead = '2026-11-19T12:10:00.000Z';
	assert.equal(laterStamp('2026-11-19T12:00:00.000Z', ahead), '2026-11-19T12:10:00.001Z');
	assert.equal(laterStamp('2026-11-19T12:20:00.000Z', ahead), '2026-11-19T12:20:00.000Z');
	assert.equal(laterStamp('2026-11-19T12:00:00.000Z', ''), '2026-11-19T12:00:00.000Z');
	const mem = normalizeData({ novels: [novel({ folderPath: 'Storm', updatedAt: ahead })] });
	const disk = normalizeData({ novels: [novel({ folderPath: 'Storm', updatedAt: ahead })] });
	applyFolderRename(mem.novels, 'Storm', 'Tempest', '2026-11-19T12:00:00.000Z');
	assert.equal(mergeForSave(mem, disk, 'me').novels[0]?.folderPath, 'Tempest');
});

test("a new install's defaults never replace real settings that have no stamp", () => {
	const real = normalizeData({ dayStartHour: 4, novels: [novel()] });
	const freshFile = normalizeData({ hasOnboarded: true });
	assert.equal(mergeForSave(real, freshFile, 'me').dayStartHour, 4);
});

test('a novel re-attached after it was removed comes back, even with other devices still listing the removal', () => {
	const removedAt = '2026-11-19T10:00:00.000Z';
	const disk = normalizeData({ removedNovels: { a: removedAt } });
	const mem = normalizeData({ novels: [novel({ id: 'a', updatedAt: '2026-11-20T09:00:00.000Z' })], removedNovels: { a: removedAt } });
	assert.deepEqual(mergeForSave(mem, disk, 'me').novels.map((n) => n.id), ['a']);
	const stale = normalizeData({ novels: [novel({ id: 'a', updatedAt: '2026-11-18T09:00:00.000Z' })] });
	assert.deepEqual(mergeForSave(stale, disk, 'me').novels, [], 'an older copy stays removed');
});
