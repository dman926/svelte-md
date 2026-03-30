import { describe, it, expect } from 'vitest';
import { createParser, defaultParser } from './index';
import { parseBlocks, getBlockContentStart, getBlockInlineRaw, serializeBlocks } from './block';
import { tokenizeInline } from './inline';
import { assertInvariant } from '$lib/test-helpers';

/** @import { InlineToken } from './types' */

// ---------------------------------------------------------------------------
// defaultParser — API surface
// ---------------------------------------------------------------------------

describe('defaultParser — API surface', () => {
	it('exposes all required methods', () => {
		const methods = /** @type {const} */ ([
			'parseBlocks',
			'getBlockContentStart',
			'getBlockInlineRaw',
			'serializeBlocks',
			'tokenizeInline',
			'tokenizeBlock',
		]);
		for (const m of methods) {
			expect(typeof defaultParser[m]).toBe('function');
		}
	});

	it('exposes options object', () => {
		expect(typeof defaultParser.options).toBe('object');
		expect(defaultParser.options).not.toBeNull();
	});
});

// ---------------------------------------------------------------------------
// defaultParser — mirrors standalone exports
// ---------------------------------------------------------------------------

describe('defaultParser — mirrors standalone exports', () => {
	const doc = '# Hello\n\n**world** and `code`\n\n> blockquote\n\n- list\n1. ordered';

	it('parseBlocks matches standalone', () => {
		expect(defaultParser.parseBlocks(doc)).toEqual(parseBlocks(doc));
	});

	it('getBlockContentStart matches standalone for each block', () => {
		const blocks = parseBlocks(doc);
		for (const b of blocks) {
			expect(defaultParser.getBlockContentStart(b)).toBe(getBlockContentStart(b));
		}
	});

	it('getBlockInlineRaw matches standalone for each block', () => {
		const blocks = parseBlocks(doc);
		for (const b of blocks) {
			expect(defaultParser.getBlockInlineRaw(b)).toBe(getBlockInlineRaw(b));
		}
	});

	it('serializeBlocks matches standalone', () => {
		const blocks = parseBlocks(doc);
		expect(defaultParser.serializeBlocks(blocks)).toBe(serializeBlocks(blocks));
	});

	it('tokenizeInline matches standalone', () => {
		expect(defaultParser.tokenizeInline('**bold** and *italic*')).toEqual(
			tokenizeInline('**bold** and *italic*'),
		);
	});
});

// ---------------------------------------------------------------------------
// createParser — composition
// ---------------------------------------------------------------------------

describe('createParser — composes block and inline options', () => {
	it('block options are forwarded', () => {
		const p = createParser({ block: { heading: false } });
		expect(p.parseBlocks('# Not heading')[0].type).toBe('paragraph');
	});

	it('inline options are forwarded', () => {
		const p = createParser({ inline: { bold: false } });
		const t = p.tokenizeInline('**bold**');
		expect(t[0].type).toBe('text');
	});

	it('block and inline options are independent', () => {
		const p = createParser({
			block: { blockquote: false },
			inline: { italic: false },
		});
		// Block: blockquote is disabled
		expect(p.parseBlocks('> not blockquote')[0].type).toBe('paragraph');
		// Inline: italic is disabled
		expect(p.tokenizeInline('*not italic*')[0].type).toBe('text');
		// Block: headings still work
		expect(p.parseBlocks('# heading')[0].type).toBe('heading');
		// Inline: bold still works
		expect(p.tokenizeInline('**bold**')[0].type).toBe('bold');
	});

	it('options are accessible via parser.options', () => {
		const opts = { block: { heading: false }, inline: { bold: false } };
		const p = createParser(opts);
		expect(p.options.block?.heading).toBe(false);
		expect(p.options.inline?.bold).toBe(false);
	});

	it('createParser() with no args behaves like defaultParser', () => {
		const p = createParser();
		const doc = '# h\n\n**bold**';
		expect(p.parseBlocks(doc)).toEqual(defaultParser.parseBlocks(doc));
	});
});

// ---------------------------------------------------------------------------
// tokenizeBlock — auto-computes contentStart
// ---------------------------------------------------------------------------

describe('parser.tokenizeBlock — auto contentStart', () => {
	it('heading — skips the # prefix', () => {
		const p = createParser();
		const [block] = p.parseBlocks('## Hello **world**');
		const tokens = p.tokenizeBlock(block);

		assertInvariant(block.raw, tokens);
		expect(tokens[0]).toMatchObject({ type: 'text', content: 'Hello ', start: 3 });
		expect(tokens[1]).toMatchObject({ type: 'bold', content: 'world' });
	});

	it('blockquote — skips the > prefix', () => {
		const p = createParser();
		const [block] = p.parseBlocks('> *quoted*');
		const tokens = p.tokenizeBlock(block);

		assertInvariant(block.raw, tokens);
		expect(tokens[0]).toMatchObject({ type: 'italic', content: 'quoted' });
	});

	it('list item — skips marker prefix', () => {
		const p = createParser();
		const [block] = p.parseBlocks('- item **text**');
		const tokens = p.tokenizeBlock(block);

		assertInvariant(block.raw, tokens);
		expect(tokens[0].start).toBe(2); // after '- '
	});

	it('paragraph — contentStart is 0', () => {
		const p = createParser();
		const [block] = p.parseBlocks('Hello **world**');
		const tokens = p.tokenizeBlock(block);

		expect(tokens[0].start).toBe(0);
	});

	it('opaque block (code fence body) → empty array', () => {
		const p = createParser();
		const blocks = p.parseBlocks('```js\nconst x = 1;\n```');
		const body = blocks[1];
		expect(p.tokenizeBlock(body)).toEqual([]);
	});

	it('opaque block (HR) → empty array', () => {
		const p = createParser();
		const [block] = p.parseBlocks('---');
		expect(p.tokenizeBlock(block)).toEqual([]);
	});

	it('opaque block (fence open) → empty array', () => {
		const p = createParser();
		const blocks = p.parseBlocks('```js\ncode\n```');
		const open = blocks[0];
		expect(p.tokenizeBlock(open)).toEqual([]);
	});

	it('blank line → empty array (contentStart = 0, no content)', () => {
		const p = createParser();
		const [block] = p.parseBlocks('');
		const tokens = p.tokenizeBlock(block);
		expect(tokens).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// createParser — custom block + inline rules compose correctly
// ---------------------------------------------------------------------------

describe('createParser — custom block + inline rules together', () => {
	const calloutRule = {
		type: 'callout',
		test(/** @type {string} */ line) {
			const m = line.match(/^:(\w+):(.*)/);
			return m ? { kind: m[1], title: m[2].trim() } : null;
		},
		contentStart(/** @type {string} */ line) {
			return line.indexOf(':', 1) + 2;
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

	it('custom block rule produces correct tokens via tokenizeBlock', () => {
		const p = createParser({ block: { custom: [calloutRule] }, inline: { custom: [mentionRule] } });
		const [block] = p.parseBlocks(':tip: See @alice for details');

		expect(block.type).toBe('callout');
		const tokens = p.tokenizeBlock(block);
		assertInvariant(block.raw, tokens);

		const mention = /** @type {InlineToken} */ (tokens.find((t) => t.type === 'mention'));
		expect(mention).toBeDefined();
		expect(mention.content).toBe('alice');
	});

	it('custom block option does not affect inline tokenization', () => {
		const p = createParser({ block: { custom: [calloutRule] } });
		// Inline tokenization still uses defaults (no mention rule)
		const t = p.tokenizeInline('@alice');
		expect(t[0].type).toBe('text');
	});
});

// ---------------------------------------------------------------------------
// Parser isolation — multiple instances
// ---------------------------------------------------------------------------

describe('createParser — instance isolation', () => {
	it('two parsers with different configs are independent', () => {
		const p1 = createParser({ block: { heading: false } });
		const p2 = createParser({ block: { heading: true } });

		expect(p1.parseBlocks('# h')[0].type).toBe('paragraph');
		expect(p2.parseBlocks('# h')[0].type).toBe('heading');
	});

	it('mutations to options after createParser have no effect', () => {
		const opts = { block: { heading: true } };
		const p = createParser(opts);

		// Mutate the original options object
		opts.block.heading = false;

		// Parser should be unaffected (it compiled options at creation time)
		// NOTE: this only holds if compileBlockConfig reads the value at compile time,
		// which it does via `options.heading !== false`
		expect(p.parseBlocks('# h')[0].type).toBe('heading');
	});
});
