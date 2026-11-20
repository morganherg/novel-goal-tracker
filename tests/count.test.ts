import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countWords } from '../src/count';

const c = countWords;

test('plain prose', () => {
	assert.equal(c(''), 0);
	assert.equal(c('   \n\n  '), 0);
	assert.equal(c('The storm came at night.'), 5);
	assert.equal(c('One.\nTwo three.\n\nFour'), 4);
});

test('contractions, hyphens, dashes, numbers', () => {
	assert.equal(c("Don't stop. It's well-known."), 4);
	assert.equal(c('It’s fine'), 2);
	assert.equal(c('word—word'), 2);
	assert.equal(c('word–word'), 2);
	assert.equal(c('word -- word'), 2);
	assert.equal(c('She wrote 50,000 words in 3.5 weeks.'), 7);
	assert.equal(c('Wait... what?!'), 2);
	assert.equal(c('"Quoted," she said.'), 3);
});

test('frontmatter is excluded only at the top', () => {
	assert.equal(c('---\ntitle: My Novel Is Great\ntags: [a, b]\n---\nHello world'), 2);
	assert.equal(c('Intro\n---\nnot: frontmatter\n---'), 3);
});

test('comments are excluded', () => {
	assert.equal(c('Keep %%drop these words%% keep'), 2);
	assert.equal(c('A\n%%\nmulti line\ncomment\n%%\nB'), 2);
	assert.equal(c('A <!-- hidden note --> B'), 2);
	assert.equal(c('A %% unclosed comment runs to the end'), 1);
});

test('code and math are excluded', () => {
	assert.equal(c('Text\n```js\nconst x = 1; // lots of words here\n```\nmore'), 2);
	assert.equal(c('Text\n~~~\ncode words\n~~~\nend'), 2);
	assert.equal(c('Use `npm run build` now'), 2);
	assert.equal(c('Energy $E = mc^2$ matters'), 2);
	assert.equal(c('A\n$$\n\\int x dx\n$$\nB'), 2);
	assert.equal(c('It costs $5 and $10 today'), 6);
});

test('Markdown syntax is not counted', () => {
	assert.equal(c('# Chapter One'), 2);
	assert.equal(c('## The *bold* and _italic_ and **strong** ~~gone~~ ==mark=='), 8);
	assert.equal(c('- one\n- two\n* three\n1. four'), 4);
	assert.equal(c('> quoted line'), 2);
	assert.equal(c('> [!note] Title here\n> body text'), 4);
	assert.equal(c('- [ ] task one\n- [x] task two'), 4);
	assert.equal(c('| a | b |\n|---|---|\n| c | d |'), 4);
	assert.equal(c('above\n\n---\n\nbelow'), 2);
	assert.equal(c('A line ^block-id'), 2);
	assert.equal(c('Fact[^1] here.\n\n[^1]: The source.'), 4);
	assert.equal(c('<span class="x">styled words</span>'), 2);
});

test('links count visible text', () => {
	assert.equal(c('See [[Chapter 2|the storm]] now'), 4);
	assert.equal(c('See [[Chapter 2]] now'), 4);
	assert.equal(c('See [[Folder/Note#Heading]]'), 3);
	assert.equal(c('Read [the guide](https://example.com/a/b) today'), 4);
	assert.equal(c('Visit https://example.com/path?x=1 today'), 2);
	assert.equal(c('Embed ![[image.png]] and ![alt text](pic.png) gone'), 3);
});

test('tags count as words', () => {
	assert.equal(c('A #draft note'), 3);
});

test('CJK characters count one each', () => {
	assert.equal(c('我爱写小说'), 5);
	assert.equal(c('これは本です'), 6);
	assert.equal(c('Hello 世界'), 3);
	assert.equal(c('안녕하세요 세계'), 2, 'Korean counts by spaces');
});

test('other scripts', () => {
	assert.equal(c('Привет мир'), 2);
	assert.equal(c('Ünïcode café naïve'), 3);
	assert.equal(c('مرحبا بالعالم'), 2);
});

test('large text stays fast', () => {
	const para = 'The quick brown fox jumps over the lazy dog. '.repeat(20) + '\n\n';
	const text = para.repeat(850); // ~153,000 words
	const t0 = performance.now();
	const n = c(text);
	const ms = performance.now() - t0;
	assert.equal(n, 9 * 20 * 850);
	assert.ok(ms < 400, `took ${ms.toFixed(0)} ms`);
});

test('optional rules count code and comments', () => {
	const md = 'Prose here\n```js\nconst answer = 42;\n```\nUse `npm test` %%note to self%% <!-- html note --> end';
	assert.equal(c(md), 4);
	assert.equal(c(md, { code: true }), 4 + 3 + 2);
	assert.equal(c(md, { comments: true }), 4 + 3 + 2);
	assert.equal(c(md, { code: true, comments: true }), 4 + 3 + 2 + 3 + 2);
});

test('review fixes: stray backticks, code holding %% or $$, entities, abbreviations', () => {
	const filler = 'He walked home. '.repeat(300);
	assert.equal(c('She typed the ` key by mistake.\n\n' + filler + '\n\nLater a `code` span.'), 6 + 900 + 3);
	assert.equal(c("``Hello,'' she said.\n\nHe left.\n\n``Bye.''"), 6);
	assert.equal(c('Use ``a ` b`` here'), 2);
	assert.equal(c('Type `%%` to comment. Then more words here.'), 7);
	assert.equal(c('Type `$$` for math. Then more words here.'), 7);
	assert.equal(c('&nbsp;&nbsp;It was a dark night.'), 5);
	assert.equal(c('Word&#8212;word and don&#39;t and Tom &amp; Jerry'), 7);
	assert.equal(c('In the U.S. at 7 a.m. e.g. now'), 8);
	assert.equal(c('At 9:30 we left'), 4);
	assert.equal(c('Mail a.b@example.com today'), 3);
	assert.equal(c('Read [the [best] book](Chapter%202.md) now.'), 5);
	assert.equal(c('> ```\n> code here\n> ```\n> words'), 1);
	assert.equal(c('See <https://example.com/x> now'), 2);
});

test('pathological input stays fast', () => {
	const evil = ('a ` b $ c [ d [[ e ![ f [^ g %').repeat(20000);
	const t0 = performance.now();
	c(evil);
	assert.ok(performance.now() - t0 < 1500, 'no catastrophic backtracking');
});

test('a backtick inside a comment or math does not hide the rest', () => {
	assert.equal(c('Intro %% rename ` later %% one `code` two\n\nthree four five six'), 7);
	assert.equal(c('Intro <!-- see ` --> one `code` two'), 3);
	assert.equal(c('Intro $$ x ` y $$ one `code` two'), 3);
	assert.equal(c('Use `a %% b` then more words'), 4);
	assert.equal(c('Unclosed %% hides the rest\n\nof the note'), 1);
});

test('many unclosed backticks in one paragraph stay fast', () => {
	const evil = 'word ` '.repeat(50000);
	const t0 = performance.now();
	assert.equal(c(evil), 25000); // single backticks pair up, so every other word is code
	assert.ok(performance.now() - t0 < 500);
});

test('code with $$, %% or <!-- inside a fence never hides prose', () => {
	const md = 'Before\n```html\n<!-- hi\n```\nafter many words here\n```bash\necho $$ && printf %%d\n```\nend';
	assert.equal(c(md), 6);
	assert.equal(c(md, { code: true }), 6 + 1 + 3); // hi; echo printf d
});

test('nested callout headers', () => {
	assert.equal(c('> [!note] Outer\n> > [!quote] Inner\n> > body words'), 4);
});
