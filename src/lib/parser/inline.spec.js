import { describe, it, expect } from 'vitest';
import { tokenizeInline, tokenizeBlock, createInlineParser } from './inline';
import { parseBlocks, getBlockContentStart } from './block';
import { assertInvariant, assertCoverage } from '$lib/test-helpers';

/** @import { InlineToken } from './types'; */

// ---------------------------------------------------------------------------
// Invariant helper — applied to every tokenization result in this suite
// ---------------------------------------------------------------------------

/**
 * Tokenize `raw` and assert the raw-offset invariant, then return the tokens.
 * @param {string} raw
 * @param {number} [contentStart=0]
 */
function tokenize(raw, contentStart = 0) {
	const tokens = tokenizeInline(raw, contentStart);
	assertInvariant(raw, tokens);
	return tokens;
}

// ---------------------------------------------------------------------------
// Empty / whitespace inputs
// ---------------------------------------------------------------------------

describe('tokenizeInline — empty / whitespace', () => {
	it('empty string returns empty array', () => {
		expect(tokenize('')).toEqual([]);
	});

	it('spaces-only returns a single text token', () => {
		const t = tokenize('   ');
		expect(t).toHaveLength(1);
		expect(t[0].type).toBe('text');
		expect(t[0].content).toBe('   ');
	});

	it('contentStart at end of string returns empty array', () => {
		expect(tokenize('hello', 5)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// text
// ---------------------------------------------------------------------------

describe('tokenizeInline — text', () => {
	it('plain string emits a single text token', () => {
		const t = tokenize('hello world');
		expect(t).toHaveLength(1);
		expect(t[0]).toMatchObject({
			type: 'text',
			raw: 'hello world',
			content: 'hello world',
			start: 0,
			end: 11,
		});
	});

	it('text token: raw === content', () => {
		const t = tokenize('abc');
		expect(t[0].raw).toBe(t[0].content);
	});

	it('text runs are flushed lazily — no one-char tokens', () => {
		const t = tokenize('abc');
		expect(t).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// escape
// ---------------------------------------------------------------------------

describe('tokenizeInline — escape', () => {
	it('backslash-escaped character', () => {
		const t = tokenize('\\*');
		expect(t).toHaveLength(1);
		expect(t[0]).toMatchObject({ type: 'escape', raw: '\\*', content: '*', start: 0, end: 2 });
	});

	it('escape in the middle of text', () => {
		const t = tokenize('not\\*italic');
		expect(t[0].type).toBe('text');
		expect(t[1].type).toBe('escape');
		expect(t[1].content).toBe('*');
		expect(t[2].type).toBe('text');
		expect(t[2].content).toBe('italic');
	});

	it('backslash at end of string is plain text (no next char)', () => {
		const t = tokenize('hello\\');
		// '\\' at end → can't form escape → text
		expect(t).toHaveLength(1);
		expect(t[0].type).toBe('text');
	});

	it('two consecutive escapes are independent tokens', () => {
		const t = tokenize('\\*\\_');
		expect(t[0]).toMatchObject({ type: 'escape', content: '*' });
		expect(t[1]).toMatchObject({ type: 'escape', content: '_' });
	});
});

// ---------------------------------------------------------------------------
// code
// ---------------------------------------------------------------------------

describe('tokenizeInline — code (backtick)', () => {
	it('single backtick span', () => {
		const t = tokenize('`code`');
		expect(t).toHaveLength(1);
		expect(t[0]).toMatchObject({ type: 'code', raw: '`code`', content: 'code', start: 0, end: 6 });
	});

	it('double-backtick span allows single backtick inside', () => {
		const t = tokenize('``a`b``');
		expect(t).toHaveLength(1);
		expect(t[0]).toMatchObject({ type: 'code', content: 'a`b' });
	});

	it('CommonMark space strip — strips one leading/trailing space', () => {
		const t = tokenize('` code `');
		expect(t[0].content).toBe('code');
	});

	it('CommonMark space strip — does NOT strip when content is all spaces', () => {
		const t = tokenize('`   `');
		expect(t[0].content).toBe('   ');
	});

	it('CommonMark space strip — does NOT strip when only one side has a space', () => {
		const t = tokenize('` code`');
		expect(t[0].content).toBe(' code');
	});

	it('unclosed backtick → text', () => {
		const t = tokenize('`not closed');
		expect(t).toHaveLength(1);
		expect(t[0].type).toBe('text');
	});

	it('backtick of wrong count does not close — single ` cannot be closed by ``', () => {
		// The `findBacktickClose` scanner requires an exact-length run.
		// A `` (2-tick run) cannot close a single-` opener → entire string is text.
		const t = tokenize('`code`` end');
		expect(t).toHaveLength(1);
		expect(t[0].type).toBe('text');
		expect(t[0].content).toBe('`code`` end');
	});

	it('code in the middle of a sentence', () => {
		const raw = 'Use `console.log` here';
		const t = tokenize(raw);
		expect(t[0]).toMatchObject({ type: 'text', content: 'Use ' });
		expect(t[1]).toMatchObject({ type: 'code', content: 'console.log' });
		expect(t[2]).toMatchObject({ type: 'text', content: ' here' });
		assertCoverage(raw, t);
	});
});

// ---------------------------------------------------------------------------
// strike
// ---------------------------------------------------------------------------

describe('tokenizeInline — strike', () => {
	it('double-tilde strikethrough', () => {
		const t = tokenize('~~strike~~');
		expect(t).toHaveLength(1);
		expect(t[0]).toMatchObject({
			type: 'strike',
			raw: '~~strike~~',
			content: 'strike',
			start: 0,
			end: 10,
		});
	});

	it('strike inside a sentence', () => {
		const raw = 'before ~~struck~~ after';
		const t = tokenize(raw);
		expect(t[1]).toMatchObject({ type: 'strike', content: 'struck' });
		assertCoverage(raw, t);
	});

	it('unclosed ~~ → text run', () => {
		const t = tokenize('~~not closed');
		expect(t).toHaveLength(1);
		expect(t[0].type).toBe('text');
	});

	it('single ~ that is not the delimiter → text', () => {
		const t = tokenize('~not strike~');
		// default delimiter is ~~ so a single ~ trigger fails startsWith check
		expect(t.every((tk) => tk.type === 'text')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// italic, bold
// ---------------------------------------------------------------------------

describe('tokenizeInline — italic (*)', () => {
	it('*italic*', () => {
		const t = tokenize('*italic*');
		expect(t).toHaveLength(1);
		expect(t[0]).toMatchObject({ type: 'italic', raw: '*italic*', content: 'italic' });
	});

	it('unclosed * → text', () => {
		const t = tokenize('*not closed');
		expect(t[0].type).toBe('text');
		expect(t[0].content).toBe('*not closed');
	});
});

describe('tokenizeInline — italic (_)', () => {
	it('_italic_', () => {
		const t = tokenize('_italic_');
		expect(t[0]).toMatchObject({ type: 'italic', content: 'italic' });
	});

	it('_ preceded by word char → NOT italic (snake_case guard)', () => {
		const t = tokenize('snake_case');
		expect(t.every((tk) => tk.type === 'text')).toBe(true);
	});

	it('_ followed by word char after closing → NOT italic', () => {
		// `_foo_bar` — closing _ is followed by 'b', a word char → not italic
		const t = tokenize('_foo_bar');
		expect(t.every((tk) => tk.type === 'text')).toBe(true);
	});

	it('_ at start of sentence is valid italic', () => {
		const t = tokenize('_italic_ word');
		expect(t[0].type).toBe('italic');
	});
});

describe('tokenizeInline — bold', () => {
	it('**bold**', () => {
		const t = tokenize('**bold**');
		expect(t[0]).toMatchObject({
			type: 'bold',
			raw: '**bold**',
			content: 'bold',
			start: 0,
			end: 8,
		});
	});

	it('__bold__', () => {
		const t = tokenize('__bold__');
		expect(t[0]).toMatchObject({ type: 'bold', content: 'bold' });
	});

	it('bold with surrounding text — offsets are correct', () => {
		const raw = 'Hello **world**!';
		const t = tokenize(raw);
		expect(t[1]).toMatchObject({ type: 'bold', start: 6, end: 15, content: 'world' });
		assertCoverage(raw, t);
	});

	it('unclosed ** → text', () => {
		const t = tokenize('**not bold');
		expect(t[0].type).toBe('text');
	});
});

// ---------------------------------------------------------------------------
// link
// ---------------------------------------------------------------------------

describe('tokenizeInline — link', () => {
	it('basic link', () => {
		const t = tokenize('[label](https://example.com)');
		expect(t).toHaveLength(1);
		expect(t[0]).toMatchObject({
			type: 'link',
			raw: '[label](https://example.com)',
			content: 'label',
			href: 'https://example.com',
			start: 0,
			end: 28,
		});
	});

	it('link with nested brackets in label', () => {
		const t = tokenize('[[nested]](url)');
		expect(t[0].type).toBe('link');
		expect(t[0].content).toBe('[nested]');
	});

	it('missing ( after ] → not a link', () => {
		const t = tokenize('[label]no-paren');
		expect(t.every((tk) => tk.type === 'text')).toBe(true);
	});

	it('link in a sentence', () => {
		const raw = 'See [this](http://x.com) for details';
		const t = tokenize(raw);
		expect(t[1].type).toBe('link');
		expect(t[1].content).toBe('this');
		expect(t[1].href).toBe('http://x.com');
		assertCoverage(raw, t);
	});
});

// ---------------------------------------------------------------------------
// image
// ---------------------------------------------------------------------------

describe('tokenizeInline — image', () => {
	it('basic image', () => {
		const t = tokenize('![alt text](https://img.png)');
		expect(t[0]).toMatchObject({
			type: 'image',
			content: 'alt text',
			alt: 'alt text',
			href: 'https://img.png',
			start: 0,
		});
	});

	it('image checked before link — ! + [ does not first become a link', () => {
		const t = tokenize('![alt](url) [link](url)');
		expect(t[0].type).toBe('image');
		expect(t[2].type).toBe('link');
	});

	it('! without [ → plain text', () => {
		const t = tokenize('! not image');
		expect(t[0].type).toBe('text');
	});

	it('![alt] without (url) → plain text', () => {
		const t = tokenize('![alt]no-paren');
		expect(t.every((tk) => tk.type === 'text')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// mixed lines — offset coverage and invariant
// ---------------------------------------------------------------------------

describe('tokenizeInline — mixed lines', () => {
	const cases = [
		'Hello **world** and `code`!',
		'*italic* and **bold** and ***both***',
		'[link](url) and ![img](url)',
		'Escape \\* and `code` and ~~strike~~',
		'## heading content with **bold**',
	];

	for (const raw of cases) {
		it(`invariant and coverage: ${JSON.stringify(raw.slice(0, 40))}`, () => {
			const t = tokenize(raw);
			expect(() => assertInvariant(raw, t)).not.toThrow();
			expect(() => assertCoverage(raw, t)).not.toThrow();
		});
	}

	it('multiple adjacent formatted spans produce correct offsets', () => {
		const raw = '**a**_b_`c`';
		const t = tokenize(raw);
		assertInvariant(raw, t);
		assertCoverage(raw, t);
		expect(t[0].type).toBe('bold');
		expect(t[1].type).toBe('italic');
		expect(t[2].type).toBe('code');
	});
});

// ---------------------------------------------------------------------------
// contentStart offset
// ---------------------------------------------------------------------------

describe('tokenizeInline — contentStart', () => {
	it('skips block prefix characters when contentStart > 0', () => {
		const raw = '## Hello **world**';
		const cs = 3; // '## '
		const t = tokenize(raw, cs);

		expect(t[0]).toMatchObject({ type: 'text', start: 3, content: 'Hello ' });
		expect(t[1]).toMatchObject({ type: 'bold', start: 9, end: 18, content: 'world' });
		assertInvariant(raw, t);
	});

	it('no tokens produced before contentStart', () => {
		const raw = '> **bold**';
		const cs = 2; // '> '
		const t = tokenize(raw, cs);

		for (const tok of t) {
			expect(tok.start).toBeGreaterThanOrEqual(cs);
		}
	});

	it('offsets are absolute within block.raw, not relative to contentStart', () => {
		const raw = '- item text';
		const cs = 2; // '- '
		const t = tokenize(raw, cs);
		expect(t[0].start).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// tokenizeBlock
// ---------------------------------------------------------------------------

describe('tokenizeBlock', () => {
	it('returns empty array for opaque blocks (code_fence_body)', () => {
		const blocks = parseBlocks('```\nconst x = 1;\n```');
		const body = blocks[1]; // code_fence_body
		const cs = getBlockContentStart(body);
		expect(tokenizeBlock(body, cs)).toEqual([]);
	});

	it('returns empty array for HR block', () => {
		const blocks = parseBlocks('---');
		const hr = blocks[0];
		expect(tokenizeBlock(hr, getBlockContentStart(hr))).toEqual([]);
	});

	it('tokenizes heading content with correct absolute offsets', () => {
		const [block] = parseBlocks('## Hello **world**');
		const cs = getBlockContentStart(block); // 3
		const t = tokenizeBlock(block, cs);

		assertInvariant(block.raw, t);
		expect(t[0]).toMatchObject({ type: 'text', content: 'Hello ', start: 3 });
		expect(t[1]).toMatchObject({ type: 'bold', content: 'world', start: 9 });
	});

	it('tokenizes blockquote content', () => {
		const [block] = parseBlocks('> *quoted*');
		const cs = getBlockContentStart(block); // 2
		const t = tokenizeBlock(block, cs);

		assertInvariant(block.raw, t);
		expect(t[0]).toMatchObject({ type: 'italic', content: 'quoted', start: 2 });
	});
});

// ---------------------------------------------------------------------------
// createInlineParser — individual feature flags
// ---------------------------------------------------------------------------

describe('createInlineParser — feature flags', () => {
	it('escape: false → backslash is plain text', () => {
		const { tokenizeInline: ti } = createInlineParser({ escape: false });
		const t = ti('\\*');
		expect(t[0].type).toBe('text');
		expect(t[0].content).toBe('\\*');
	});

	it('code: false → backticks are plain text', () => {
		const { tokenizeInline: ti } = createInlineParser({ code: false });
		const t = ti('`code`');
		expect(t[0].type).toBe('text');
	});

	it('bold: false → ** is plain text', () => {
		const { tokenizeInline: ti } = createInlineParser({ bold: false });
		const t = ti('**bold**');
		expect(t[0].type).toBe('text');
		expect(t[0].content).toBe('**bold**');
	});

	it('italic: false → * is plain text', () => {
		const { tokenizeInline: ti } = createInlineParser({ italic: false });
		const t = ti('*italic*');
		expect(t[0].type).toBe('text');
	});

	it('strike: false → ~~ is plain text', () => {
		const { tokenizeInline: ti } = createInlineParser({ strike: false });
		const t = ti('~~strike~~');
		expect(t[0].type).toBe('text');
	});

	it('link: false → [text](url) is plain text', () => {
		const { tokenizeInline: ti } = createInlineParser({ link: false });
		const t = ti('[label](url)');
		expect(t.every((tk) => tk.type === 'text')).toBe(true);
	});

	it('image: false → ![alt](url) — ! becomes text, rest becomes link', () => {
		const { tokenizeInline: ti } = createInlineParser({ image: false });
		const t = ti('![alt](url)');
		expect(t[0]).toMatchObject({ type: 'text', content: '!' });
		expect(t[1]).toMatchObject({ type: 'link', content: 'alt' });
	});
});

// ---------------------------------------------------------------------------
// createInlineParser — custom strike delimiter
// ---------------------------------------------------------------------------

describe('createInlineParser — custom strike delimiter', () => {
	it('single-tilde strike: { delimiter: "~" }', () => {
		const { tokenizeInline: ti } = createInlineParser({ strike: { delimiter: '~' } });
		const t = ti('~struck~');
		expect(t[0]).toMatchObject({ type: 'strike', content: 'struck', raw: '~struck~' });
	});

	it('custom delimiter does not match the default ~~', () => {
		const { tokenizeInline: ti } = createInlineParser({ strike: { delimiter: '~' } });
		// With single ~ delimiter, '~~text~~' tries: first ~ matches delimiter,
		// scans for close ~, finds the second ~ at position 1, content is ''
		// Then continues with 'text~~' as text
		const t = ti('~~text~~');
		// Should not produce a strike with content 'text'
		const strike = t.find((tk) => tk.type === 'strike' && tk.content === 'text');
		expect(strike).toBeUndefined();
	});

	it('three-char delimiter', () => {
		const { tokenizeInline: ti } = createInlineParser({ strike: { delimiter: '~~~' } });
		const t = ti('~~~struck~~~');
		expect(t[0]).toMatchObject({ type: 'strike', content: 'struck' });
	});
});

// ---------------------------------------------------------------------------
// createInlineParser — custom rules
// ---------------------------------------------------------------------------

describe('createInlineParser — custom rules', () => {
	const highlightRule = {
		type: 'highlight',
		scan(/** @type {string} */ raw, /** @type {number} */ i) {
			if (!raw.startsWith('==', i)) return null;
			const close = raw.indexOf('==', i + 2);
			if (close === -1) return null;
			return {
				type: 'highlight',
				raw: raw.slice(i, close + 2),
				content: raw.slice(i + 2, close),
				start: i,
				end: close + 2,
			};
		},
	};

	const mentionRule = {
		type: 'mention',
		scan(/** @type {string} */ raw, /** @type {number} */ i) {
			if (raw[i] !== '@') return null;
			const m = raw.slice(i).match(/^@([\w-]+)/);
			if (!m) return null;
			return { type: 'mention', raw: m[0], content: m[1], start: i, end: i + m[0].length };
		},
	};

	it('custom rule fires at the right position', () => {
		const { tokenizeInline: ti } = createInlineParser({ custom: [highlightRule] });
		const t = ti('See ==highlighted== text');
		const hl = /** @type {InlineToken} */ (t.find((tk) => tk.type === 'highlight'));
		expect(hl).toBeDefined();
		expect(hl.content).toBe('highlighted');
		expect(hl.start).toBe(4);
	});

	it('custom rule satisfies raw-offset invariant', () => {
		const { tokenizeInline: ti } = createInlineParser({ custom: [highlightRule] });
		const raw = 'Before ==mark== after **bold**';
		const t = ti(raw);
		expect(() => assertInvariant(raw, t)).not.toThrow();
		expect(() => assertCoverage(raw, t)).not.toThrow();
	});

	it('mention rule captures @username', () => {
		const { tokenizeInline: ti } = createInlineParser({ custom: [mentionRule] });
		const t = ti('Hello @alice and @bob!');
		const mentions = t.filter((tk) => tk.type === 'mention');
		expect(mentions).toHaveLength(2);
		expect(mentions[0].content).toBe('alice');
		expect(mentions[1].content).toBe('bob');
	});

	it('custom rules run BEFORE built-ins — can override bold', () => {
		const overrideBold = {
			type: 'my_bold',
			scan(/** @type {string} */ raw, /** @type {number} */ i) {
				if (!raw.startsWith('**', i)) return null;
				const close = raw.indexOf('**', i + 2);
				if (close === -1) return null;
				return {
					type: 'my_bold',
					raw: raw.slice(i, close + 2),
					content: raw.slice(i + 2, close),
					start: i,
					end: close + 2,
				};
			},
		};
		const { tokenizeInline: ti } = createInlineParser({ custom: [overrideBold] });
		const t = ti('**hello**');
		expect(t[0].type).toBe('my_bold');
		expect(t[0].content).toBe('hello');
	});

	it('multiple custom rules — first match wins at a given position', () => {
		const r1 = {
			type: 'first',
			scan: (/** @type {string} */ raw, /** @type {number} */ i) =>
				raw[i] === '@' ? { type: 'first', raw: '@', content: '@', start: i, end: i + 1 } : null,
		};
		const r2 = {
			type: 'second',
			scan: (/** @type {string} */ raw, /** @type {number} */ i) =>
				raw[i] === '@' ? { type: 'second', raw: '@', content: '@', start: i, end: i + 1 } : null,
		};
		const { tokenizeInline: ti } = createInlineParser({ custom: [r1, r2] });
		const t = ti('@');
		expect(t[0].type).toBe('first');
	});
});
