/*
 * Word counting for prose written in Markdown. Pure: text in, number out.
 *
 * Excluded: frontmatter, %% comments %%, HTML comments, fenced and inline code,
 * math, embeds, images, URLs, block IDs, footnote markers, and Markdown syntax.
 * Links count their visible text. Chinese and Japanese characters count one
 * word each; Korean, which puts spaces between words, counts by spaces.
 * No regex lookbehind (unsupported on older iOS).
 */

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
// Fences may sit inside blockquotes and callouts ("> ```").
const FENCED_CODE = /^([ \t>]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t>]*\2[`~]*[ \t]*(?=\n|$)|$)/gm;
const INLINE_MATH = /\$(?=\S)[^$\n]*?\S\$(?!\d)/g;
// Links are capped at a few hundred characters so an unclosed "[" in a long
// paragraph can't make counting slow.
const EMBED = /!\[\[[^\]\n]{0,500}\]\]/g;
const IMAGE = /!\[[^\]\n]{0,500}\]\([^)\n]{0,1000}\)/g;
const WIKILINK = /\[\[([^\]|\n]{0,500})(?:\|([^\]\n]{0,500}))?\]\]/g;
// Link text may contain one level of brackets: [the [best] book](x.md).
const MD_LINK = /\[((?:[^[\]\n]|\[[^\]\n]{0,200}\]){0,500})\]\([^)\n]{0,1000}\)/g;
const URL = /<?\b(?:https?|ftp|obsidian):\/\/[^\s>]+>?|\bwww\.[^\s>]+/gi;
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const APOSTROPHE_ENTITY = /&(?:#39|#x27|#8217|#8216|apos|rsquo|lsquo);/gi;
const HTML_ENTITY = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi;
const FOOTNOTE_REF = /\[\^[^\]\n]{0,200}\]:?/g;
const BLOCK_ID = /(?:^|\s)\^[A-Za-z0-9-]+[ \t]*$/gm;
const CALLOUT = /^((?:[ \t]*>)+[ \t]*)\[![^\]\n]*\][+-]?/gm;
const TASK_BOX = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+)\[[ xX/-]\]/gm;
const HTML_TAG = /<\/?[A-Za-z][^>\n]*>/g;
const ORDERED_MARKER = /^([ \t>]*)\d+[.)][ \t]+/gm;

/** Scripts written without spaces between words: one character = one word. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
/**
 * A word: an abbreviation like "U.S." or "a.m.", or letters/digits/marks joined
 * by internal apostrophes or hyphens ("don't", "well-known"), or by . , or :
 * before a digit ("3.14", "50,000", "9:30").
 */
const WORD = /(?:\p{L}\.){2,}|[\p{L}\p{N}\p{M}]+(?:(?:['\u2019\u02BC-]|[.,:](?=\p{N}))[\p{L}\p{N}\p{M}]+)*/gu;

export interface CountRules {
	/** Count words inside code blocks and inline code. Default false. */
	code?: boolean;
	/** Count words inside %% comments %% and HTML comments. Default false. */
	comments?: boolean;
}

const FENCE_LINE = /^[ \t>]*(?:`{3,}|~{3,})[^\n]*$/gm;
/** Openers of the regions read left to right: code spans, comments, math blocks. */
const REGION_OPENER = /`+|%%|<!--|\$\$/g;
const BACKTICKS = /`+/g;
const BLANK_LINE = /\n[ \t>]*\n/g;

/**
 * Remove (or keep the words of) inline code, %% comments %%, HTML comments, and
 * $$ math in one left-to-right pass, so whichever opens first wins: a backtick
 * inside a comment can't hide the comment's end, and %% inside code is just text.
 * Like Obsidian, an unclosed comment or math block runs to the end of the note.
 * A code span stays inside one paragraph and closes with exactly as many backticks.
 */
function stripRegions(t: string, rules: CountRules): string {
	let out = '';
	let i = 0;
	// For each backtick-run length, the paragraph end up to which no closer exists.
	const noCloserUntil = new Map<number, number>();
	// End of the paragraph containing the current position, found once per paragraph.
	let paragraphEnd = -1;
	const paragraphEndAfter = (from: number): number => {
		if (from > paragraphEnd) {
			BLANK_LINE.lastIndex = from;
			const blank = BLANK_LINE.exec(t);
			paragraphEnd = blank ? blank.index : t.length;
		}
		return paragraphEnd;
	};
	REGION_OPENER.lastIndex = 0;
	for (let m = REGION_OPENER.exec(t); m; m = REGION_OPENER.exec(t)) {
		const start = m.index;
		const token = m[0];
		out += t.slice(i, start);
		let end: number;
		if (token.startsWith('`')) {
			const len = token.length;
			const close =
				(noCloserUntil.get(len) ?? -1) > start
					? -1
					: findCloser(t, start + len, len, paragraphEndAfter(start + len), noCloserUntil);
			if (close < 0) {
				out += token; // a stray backtick: plain text
				end = start + len;
			} else {
				out += rules.code ? ` ${t.slice(start + len, close)} ` : ' ';
				end = close + len;
			}
		} else {
			const closer = token === '<!--' ? '-->' : token;
			const close = t.indexOf(closer, start + token.length);
			const inner = t.slice(start + token.length, close < 0 ? t.length : close);
			const keep = token === '$$' ? false : rules.comments === true;
			out += keep ? ` ${inner} ` : ' ';
			end = close < 0 ? t.length : close + closer.length;
		}
		i = end;
		REGION_OPENER.lastIndex = end;
	}
	return out + t.slice(i);
}

/** Index of a run of exactly `len` backticks before the paragraph ends, or -1. */
function findCloser(
	t: string,
	from: number,
	len: number,
	paragraphEnd: number,
	noCloserUntil: Map<number, number>,
): number {
	BACKTICKS.lastIndex = from;
	for (let m = BACKTICKS.exec(t); m && m.index < paragraphEnd; m = BACKTICKS.exec(t)) {
		if (m[0].length === len) return m.index;
	}
	noCloserUntil.set(len, paragraphEnd);
	return -1;
}

/** Remove everything that is not prose, leaving the words a reader would read. */
export function stripMarkdown(text: string, rules: CountRules = {}): string {
	let t = text.replace(/\r\n?/g, '\n');
	t = t.replace(FRONTMATTER, '');
	// Fenced code is set apart first: its contents count only if asked, and are
	// never read for comments or math. Fence lines (```js) are never words.
	let rest = '';
	let last = 0;
	FENCED_CODE.lastIndex = 0;
	for (let m = FENCED_CODE.exec(t); m; m = FENCED_CODE.exec(t)) {
		rest += stripRegions(t.slice(last, m.index), rules);
		rest += rules.code ? ` ${m[0].replace(FENCE_LINE, ' ')} ` : ' ';
		last = m.index + m[0].length;
		if (m[0].length === 0) FENCED_CODE.lastIndex++;
	}
	t = rest + stripRegions(t.slice(last), rules);
	t = t.replace(INLINE_MATH, ' ');
	t = t.replace(EMBED, ' ');
	t = t.replace(IMAGE, ' ');
	t = t.replace(WIKILINK, (_m, target: string, alias: string | undefined) => {
		if (alias !== undefined && alias.trim()) return ` ${alias} `;
		// [[Folder/Note#Heading]] reads as "Note Heading".
		const visible = target.split('/').pop() ?? '';
		return ` ${visible.replace(/[#^]/g, ' ')} `;
	});
	t = t.replace(MD_LINK, ' $1 ');
	t = t.replace(URL, ' ');
	t = t.replace(EMAIL, ' email ');
	t = t.replace(FOOTNOTE_REF, ' ');
	t = t.replace(BLOCK_ID, ' ');
	t = t.replace(CALLOUT, '$1');
	t = t.replace(TASK_BOX, '$1');
	t = t.replace(ORDERED_MARKER, '$1');
	t = t.replace(HTML_TAG, ' ');
	t = t.replace(APOSTROPHE_ENTITY, "'");
	t = t.replace(HTML_ENTITY, ' ');
	return t;
}

/** Count words in a Markdown note. */
export function countWords(text: string, rules: CountRules = {}): number {
	if (!text) return 0;
	const prose = stripMarkdown(text, rules);
	let count = 0;
	const withoutCjk = prose.replace(CJK, () => {
		count++;
		return ' ';
	});
	const words = withoutCjk.match(WORD);
	return count + (words ? words.length : 0);
}
