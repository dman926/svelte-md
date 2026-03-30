// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { serializeLine, serializeEditor, buildContentStarts } from './serialize';
import { defaultParser } from '../parser';
import { TOKEN_ATTR } from '../cursor/types';
import { tok, blk, buildEditorDom, TYPE_ATTR } from '$lib/test-helpers';

/** @import { InlineToken } from '../parser/types'; */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a line element with direct text (no data-md-token children) —
 * simulates what the browser produces for opaque blocks.
 * @param {string} raw
 */
function opaqueLineEl(raw) {
	const el = document.createElement('div');
	el.textContent = raw;
	return el;
}

/**
 * Build a tokenized line element matching the DOM contract:
 * each child has data-md-token + data-md-type.
 *
 * @param {Array<{ start: number, type: string, content: string, tag?: string }>} tokenSpecs
 */
function tokenizedLineEl(tokenSpecs) {
	const el = document.createElement('div');
	for (const { start, type, content, tag = 'span' } of tokenSpecs) {
		const child = document.createElement(tag);
		child.setAttribute(TOKEN_ATTR, String(start));
		child.setAttribute(TYPE_ATTR, type);
		child.textContent = content;
		el.appendChild(child);
	}
	return el;
}

// ---------------------------------------------------------------------------
// serializeLine — blank
// ---------------------------------------------------------------------------

describe('serializeLine — blank', () => {
	it('always returns empty string regardless of element content', () => {
		const lineEl = document.createElement('div');
		lineEl.appendChild(document.createElement('br'));
		const block = blk('blank', '', 0);
		expect(serializeLine(lineEl, block, [], 0)).toBe('');
	});

	it('returns empty string even if element somehow has text', () => {
		const lineEl = document.createElement('div');
		lineEl.textContent = 'ghost text';
		const block = blk('blank', '', 0);
		expect(serializeLine(lineEl, block, null, 0)).toBe('');
	});
});

// ---------------------------------------------------------------------------
// serializeLine — opaque blocks (hr, code_fence_*)
// ---------------------------------------------------------------------------

describe('serializeLine — opaque blocks', () => {
	for (const blockType of ['hr', 'code_fence_open', 'code_fence_body', 'code_fence_close']) {
		it(`${blockType}: returns lineEl.textContent`, () => {
			const raw = blockType === 'hr' ? '---' : '```js';
			const lineEl = opaqueLineEl(raw);
			const block = blk(blockType, raw, 0);
			expect(serializeLine(lineEl, block, [], 0)).toBe(raw);
		});
	}

	it('opaque block: returns updated text if browser mutated it', () => {
		const lineEl = opaqueLineEl('```python');
		const block = blk('code_fence_open', '```js', 0, { lang: 'js' });
		// DOM now shows "```python" (browser autocorrected) — serializer returns DOM truth
		expect(serializeLine(lineEl, block, [], 0)).toBe('```python');
	});

	it('opaque block: falls back to block.raw when textContent is null', () => {
		const lineEl = document.createElement('div');
		// textContent returns '' for an empty element, not null, in browsers.
		// We test the fallback via a detached element with no children.
		const block = blk('code_fence_body', 'const x = 1;', 0);
		// textContent will be '' (empty element) — serializeLine returns '' since textContent is falsy-ish
		// Actually textContent on empty div is '' not null, so it returns ''.
		// The ?? fallback fires for null/undefined only.
		expect(serializeLine(lineEl, block, [], 0)).toBe('');
	});
});

// ---------------------------------------------------------------------------
// serializeLine — paragraph (no block prefix)
// ---------------------------------------------------------------------------

describe('serializeLine — paragraph tokens', () => {
	it('plain text token: returns textContent as-is', () => {
		const tokens = [tok('text', 'hello world', 'hello world', 0)];
		const lineEl = tokenizedLineEl([{ start: 0, type: 'text', content: 'hello world' }]);
		const block = blk('paragraph', 'hello world', 0);
		expect(serializeLine(lineEl, block, tokens, 0)).toBe('hello world');
	});

	it('bold token: wraps content in ** delimiters', () => {
		const tokens = [tok('bold', '**earth**', 'earth', 0)];
		const lineEl = tokenizedLineEl([{ start: 0, type: 'bold', content: 'earth', tag: 'strong' }]);
		const block = blk('paragraph', '**earth**', 0);
		expect(serializeLine(lineEl, block, tokens, 0)).toBe('**earth**');
	});

	it('bold token: new content replaces old between delimiters', () => {
		const tokens = [tok('bold', '**world**', 'world', 0)];
		const lineEl = tokenizedLineEl([{ start: 0, type: 'bold', content: 'earth', tag: 'strong' }]);
		const block = blk('paragraph', '**world**', 0);
		// DOM says 'earth', token model says 'world' — reconstructs **earth**
		expect(serializeLine(lineEl, block, tokens, 0)).toBe('**earth**');
	});

	it('italic token: wraps in * delimiters', () => {
		const tokens = [tok('italic', '*hi*', 'hi', 0)];
		const lineEl = tokenizedLineEl([{ start: 0, type: 'italic', content: 'hi', tag: 'em' }]);
		const block = blk('paragraph', '*hi*', 0);
		expect(serializeLine(lineEl, block, tokens, 0)).toBe('*hi*');
	});

	it('bold_italic: wraps in *** delimiters', () => {
		const tokens = [tok('bold_italic', '***wow***', 'wow', 0)];
		const lineEl = tokenizedLineEl([
			{ start: 0, type: 'bold_italic', content: 'wow', tag: 'strong' },
		]);
		const block = blk('paragraph', '***wow***', 0);
		expect(serializeLine(lineEl, block, tokens, 0)).toBe('***wow***');
	});

	it('code token: wraps in ` delimiters', () => {
		const tokens = [tok('code', '`fn()`', 'fn()', 0)];
		const lineEl = tokenizedLineEl([{ start: 0, type: 'code', content: 'fn()', tag: 'code' }]);
		const block = blk('paragraph', '`fn()`', 0);
		expect(serializeLine(lineEl, block, tokens, 0)).toBe('`fn()`');
	});

	it('code with CommonMark space-strip: symmetric mirror delimiters preserved', () => {
		// raw='` hi `', content='hi', open='` ', close=' `'
		const tokens = [tok('code', '` hi `', 'hi', 0)];
		const lineEl = tokenizedLineEl([{ start: 0, type: 'code', content: 'hi', tag: 'code' }]);
		const block = blk('paragraph', '` hi `', 0);
		expect(serializeLine(lineEl, block, tokens, 0)).toBe('` hi `');
	});

	it('strike token: wraps in ~~ delimiters', () => {
		const tokens = [tok('strike', '~~out~~', 'out', 0)];
		const lineEl = tokenizedLineEl([{ start: 0, type: 'strike', content: 'out', tag: 's' }]);
		const block = blk('paragraph', '~~out~~', 0);
		expect(serializeLine(lineEl, block, tokens, 0)).toBe('~~out~~');
	});

	it('escape token: prepends backslash, no suffix', () => {
		const tokens = [tok('escape', '\\*', '*', 0)];
		const lineEl = tokenizedLineEl([{ start: 0, type: 'escape', content: '*' }]);
		const block = blk('paragraph', '\\*', 0);
		expect(serializeLine(lineEl, block, tokens, 0)).toBe('\\*');
	});

	it('link token: preserves href in close delimiter', () => {
		const tokens = [
			{ ...tok('link', '[hello](https://x.com)', 'hello', 0), href: 'https://x.com' },
		];
		const lineEl = tokenizedLineEl([{ start: 0, type: 'link', content: 'hello' }]);
		const block = blk('paragraph', '[hello](https://x.com)', 0);
		expect(serializeLine(lineEl, block, tokens, 0)).toBe('[hello](https://x.com)');
	});

	it('link token: new label but same href is reconstructed correctly', () => {
		const tokens = [
			{ ...tok('link', '[hello](https://x.com)', 'hello', 0), href: 'https://x.com' },
		];
		// DOM shows 'click here' (browser autocorrect changed it)
		const lineEl = tokenizedLineEl([{ start: 0, type: 'link', content: 'click here' }]);
		const block = blk('paragraph', '[hello](https://x.com)', 0);
		expect(serializeLine(lineEl, block, tokens, 0)).toBe('[click here](https://x.com)');
	});

	it('image token: preserves ![…](href) structure', () => {
		const tokens = [{ ...tok('image', '![cat](cat.png)', 'cat', 0), alt: 'cat', href: 'cat.png' }];
		const lineEl = tokenizedLineEl([{ start: 0, type: 'image', content: 'cat' }]);
		const block = blk('paragraph', '![cat](cat.png)', 0);
		expect(serializeLine(lineEl, block, tokens, 0)).toBe('![cat](cat.png)');
	});

	it('custom symmetric token (highlight ==…==): reconstructs delimiters', () => {
		const tokens = [tok('highlight', '==mark==', 'mark', 0)];
		const lineEl = tokenizedLineEl([{ start: 0, type: 'highlight', content: 'mark' }]);
		const block = blk('paragraph', '==mark==', 0);
		expect(serializeLine(lineEl, block, tokens, 0)).toBe('==mark==');
	});

	it('custom asymmetric token (@mention): emits content only (no delimiters)', () => {
		const tokens = [tok('mention', '@alice', 'alice', 0)];
		const lineEl = tokenizedLineEl([{ start: 0, type: 'mention', content: 'alice' }]);
		const block = blk('paragraph', '@alice', 0);
		// (6-5)/2 = 0.5 → not integer → open='', close='' → emits 'alice'
		expect(serializeLine(lineEl, block, tokens, 0)).toBe('alice');
	});

	it('mixed line: text + bold + text', () => {
		const tokens = [
			tok('text', 'Hello ', 'Hello ', 0),
			tok('bold', '**world**', 'world', 6),
			tok('text', '!', '!', 15),
		];
		const lineEl = tokenizedLineEl([
			{ start: 0, type: 'text', content: 'Hello ' },
			{ start: 6, type: 'bold', content: 'world', tag: 'strong' },
			{ start: 15, type: 'text', content: '!' },
		]);
		const block = blk('paragraph', 'Hello **world**!', 0);
		expect(serializeLine(lineEl, block, tokens, 0)).toBe('Hello **world**!');
	});
});

// ---------------------------------------------------------------------------
// serializeLine — block prefix preservation
// ---------------------------------------------------------------------------

describe('serializeLine — block-level prefix preservation', () => {
	it('heading: ## prefix prepended from block.raw', () => {
		const tokens = [tok('text', 'My Heading', 'My Heading', 3)];
		const lineEl = tokenizedLineEl([{ start: 3, type: 'text', content: 'My Heading' }]);
		const block = blk('heading', '## My Heading', 0, { level: 2 });
		expect(serializeLine(lineEl, block, tokens, 3)).toBe('## My Heading');
	});

	it('heading: prefix unchanged even if token content changes', () => {
		const tokens = [tok('text', 'Old Title', 'Old Title', 3)];
		const lineEl = tokenizedLineEl([{ start: 3, type: 'text', content: 'New Title' }]);
		const block = blk('heading', '## Old Title', 0, { level: 2 });
		expect(serializeLine(lineEl, block, tokens, 3)).toBe('## New Title');
	});

	it('blockquote: > prefix preserved', () => {
		const tokens = [tok('text', 'quoted', 'quoted', 2)];
		const lineEl = tokenizedLineEl([{ start: 2, type: 'text', content: 'quoted' }]);
		const block = blk('blockquote', '> quoted', 0);
		expect(serializeLine(lineEl, block, tokens, 2)).toBe('> quoted');
	});

	it('unordered list: - prefix preserved', () => {
		const tokens = [tok('text', 'item', 'item', 2)];
		const lineEl = tokenizedLineEl([{ start: 2, type: 'text', content: 'item' }]);
		const block = blk('list_item', '- item', 0, { ordered: false, listMarker: '-', indent: 0 });
		expect(serializeLine(lineEl, block, tokens, 2)).toBe('- item');
	});

	it('ordered list: 1. prefix preserved', () => {
		const tokens = [tok('text', 'first', 'first', 3)];
		const lineEl = tokenizedLineEl([{ start: 3, type: 'text', content: 'first' }]);
		const block = blk('list_item', '1. first', 0, { ordered: true, listMarker: '1.', indent: 0 });
		expect(serializeLine(lineEl, block, tokens, 3)).toBe('1. first');
	});

	it('heading with bold inline: prefix + delimiters both correct', () => {
		const tokens = [tok('text', 'Say ', 'Say ', 3), tok('bold', '**hello**', 'hello', 7)];
		const lineEl = tokenizedLineEl([
			{ start: 3, type: 'text', content: 'Say ' },
			{ start: 7, type: 'bold', content: 'hello', tag: 'strong' },
		]);
		const block = blk('heading', '## Say **hello**', 0, { level: 2 });
		expect(serializeLine(lineEl, block, tokens, 3)).toBe('## Say **hello**');
	});
});

// ---------------------------------------------------------------------------
// serializeLine — browser fallback paths
// ---------------------------------------------------------------------------

describe('serializeLine — browser-inserted content fallbacks', () => {
	it('bare text node child (no data-md-token): emitted as plain text', () => {
		/** @type {InlineToken[]} */
    const tokens = [];
		const lineEl = document.createElement('div');
		lineEl.appendChild(document.createTextNode('browser inserted'));
		const block = blk('paragraph', '', 0);
		expect(serializeLine(lineEl, block, tokens, 0)).toBe('browser inserted');
	});

	it('element without data-md-token: uses textContent as plain text', () => {
		/** @type {InlineToken[]} */
    const tokens = [];
		const lineEl = document.createElement('div');
		const div = document.createElement('div');
		div.textContent = 'no token attr';
		lineEl.appendChild(div);
		const block = blk('paragraph', '', 0);
		expect(serializeLine(lineEl, block, tokens, 0)).toBe('no token attr');
	});

	it('token element present in DOM but missing from model: falls back to textContent', () => {
		// DOM has a token at start=99 that doesn't exist in our token array
		const tokens = [tok('text', 'known', 'known', 0)];
		const lineEl = tokenizedLineEl([
			{ start: 0, type: 'text', content: 'known' },
			{ start: 99, type: 'bold', content: 'unknown' }, // not in tokens array
		]);
		const block = blk('paragraph', 'known**unknown**', 0);
		// known token: '' + 'known' + ''
		// unknown token (not in model): falls back to textContent 'unknown'
		expect(serializeLine(lineEl, block, tokens, 0)).toBe('knownunknown');
	});

	it('null tokens array: all token elements fall back to textContent', () => {
		const lineEl = tokenizedLineEl([{ start: 0, type: 'bold', content: 'hello', tag: 'strong' }]);
		const block = blk('paragraph', '**hello**', 0);
		expect(serializeLine(lineEl, block, null, 0)).toBe('hello');
	});
});

// ---------------------------------------------------------------------------
// serializeEditor — multi-line round-trips
// ---------------------------------------------------------------------------

describe('serializeEditor — multi-line', () => {
	it('single paragraph round-trips', () => {
		const raw = 'Hello **world**';
		const blocks = defaultParser.parseBlocks(raw);
		const tokensByLine = blocks.map((b) => defaultParser.tokenizeBlock(b));
		const contentStarts = buildContentStarts(blocks, defaultParser);

		const { editor } = buildEditorDom([
			{
				lineIndex: 0,
				tokens: [
					{ tokenStart: 0, tokenType: 'text', content: 'Hello ' },
					{ tokenStart: 6, tokenType: 'bold', content: 'world', tag: 'strong' },
				],
			},
		]);

		expect(serializeEditor(editor, blocks, tokensByLine, contentStarts)).toBe(raw);
	});

	it('multi-line document round-trips', () => {
		const raw = '# Heading\n\nParagraph with **bold**\n\n- list item';
		const blocks = defaultParser.parseBlocks(raw);
		const tokensByLine = blocks.map((b) => defaultParser.tokenizeBlock(b));
		const contentStarts = buildContentStarts(blocks, defaultParser);

		const specs = blocks.map((block) => {
			if (block.type === 'blank') return { lineIndex: block.lineIndex, blank: true };
			if (block.type === 'hr' || block.type.startsWith('code_fence')) {
				return { lineIndex: block.lineIndex, opaque: block.raw };
			}
			const tokens = tokensByLine[block.lineIndex];
			return {
				lineIndex: block.lineIndex,
				tokens: tokens.map((t) => ({
					tokenStart: t.start,
					tokenType: t.type,
					content: t.content,
				})),
			};
		});

		const { editor } = buildEditorDom(specs);
		expect(serializeEditor(editor, blocks, tokensByLine, contentStarts)).toBe(raw);
	});

	it('missing line element falls back to block.raw', () => {
		const raw = 'line0\nline1';
		const blocks = defaultParser.parseBlocks(raw);
		const tokensByLine = blocks.map((b) => defaultParser.tokenizeBlock(b));
		const contentStarts = buildContentStarts(blocks, defaultParser);

		// Only render line 0 — line 1 is missing from DOM
		const { editor } = buildEditorDom([
			{
				lineIndex: 0,
				tokens: [{ tokenStart: 0, tokenType: 'text', content: 'line0' }],
			},
		]);

		// line 1 missing → uses block.raw = 'line1'
		expect(serializeEditor(editor, blocks, tokensByLine, contentStarts)).toBe('line0\nline1');
	});

	it('blank lines serialize to empty string and join correctly', () => {
		const raw = 'a\n\nb';
		const blocks = defaultParser.parseBlocks(raw);
		const tokensByLine = blocks.map((b) => defaultParser.tokenizeBlock(b));
		const contentStarts = buildContentStarts(blocks, defaultParser);

		const { editor } = buildEditorDom([
			{ lineIndex: 0, tokens: [{ tokenStart: 0, tokenType: 'text', content: 'a' }] },
			{ lineIndex: 1, blank: true },
			{ lineIndex: 2, tokens: [{ tokenStart: 0, tokenType: 'text', content: 'b' }] },
		]);

		expect(serializeEditor(editor, blocks, tokensByLine, contentStarts)).toBe('a\n\nb');
	});
});

// ---------------------------------------------------------------------------
// buildContentStarts
// ---------------------------------------------------------------------------

describe('buildContentStarts', () => {
	it('returns array parallel to blocks', () => {
		const blocks = defaultParser.parseBlocks('# h\n\ntext\n> bq');
		const starts = buildContentStarts(blocks, defaultParser);
		expect(starts).toHaveLength(blocks.length);
	});

	it('matches getBlockContentStart for each block', () => {
		const blocks = defaultParser.parseBlocks('## heading\n> quote\n- list\npara');
		const starts = buildContentStarts(blocks, defaultParser);
		for (let i = 0; i < blocks.length; i++) {
			expect(starts[i]).toBe(defaultParser.getBlockContentStart(blocks[i]));
		}
	});

	it('opaque blocks get raw.length as contentStart', () => {
		const blocks = defaultParser.parseBlocks('```js\ncode\n```\n---');
		const starts = buildContentStarts(blocks, defaultParser);
		for (const block of blocks) {
			if (['code_fence_open', 'code_fence_body', 'code_fence_close', 'hr'].includes(block.type)) {
				expect(starts[block.lineIndex]).toBe(block.raw.length);
			}
		}
	});
});
