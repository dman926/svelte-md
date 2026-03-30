import { describe, it, expect } from 'vitest';
import {
	parseBlocks,
	getBlockContentStart,
	getBlockInlineRaw,
	serializeBlocks,
	createBlockParser,
} from './block';
/** @import { Block, BlockParseContext } from './types'; */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Shorthand: parse a single-line string and return the first block.
 * @param {string} raw
 */
const parseLine = (raw) => parseBlocks(raw)[0];

// ---------------------------------------------------------------------------
// parseBlocks — type classification
// ---------------------------------------------------------------------------

describe('parseBlocks — type classification', () => {
	it('classifies ATX headings level 1–6', () => {
		for (let level = 1; level <= 6; level++) {
			const hashes = '#'.repeat(level);
			const block = parseLine(`${hashes} Heading`);
			expect(block.type).toBe('heading');
			expect(block.meta.level).toBe(level);
		}
	});

	it('does NOT classify heading when # is not followed by space or end of line', () => {
		// "#Heading" — `H` is not a space or end of string
		expect(parseLine('#Heading').type).toBe('paragraph');
	});

	it('classifies lone # as heading (end-of-line rule)', () => {
		const block = parseLine('#');
		expect(block.type).toBe('heading');
		expect(block.meta.level).toBe(1);
	});

	it('classifies blank lines', () => {
		expect(parseLine('').type).toBe('blank');
		expect(parseLine('   ').type).toBe('blank');
		expect(parseLine('\t').type).toBe('blank');
	});

	it('classifies blockquotes', () => {
		expect(parseLine('> text').type).toBe('blockquote');
		expect(parseLine('>text').type).toBe('blockquote');
	});

	it('classifies unordered list items with all three markers', () => {
		for (const marker of ['-', '*', '+']) {
			const block = parseLine(`${marker} item`);
			expect(block.type).toBe('list_item');
			expect(block.meta.ordered).toBe(false);
			expect(block.meta.listMarker).toBe(marker);
		}
	});

	it('classifies ordered list items', () => {
		const block = parseLine('1. item');
		expect(block.type).toBe('list_item');
		expect(block.meta.ordered).toBe(true);
		expect(block.meta.listMarker).toBe('1.');
	});

	it('classifies ordered list items with multi-digit numbers', () => {
		const block = parseLine('42. item');
		expect(block.type).toBe('list_item');
		expect(block.meta.ordered).toBe(true);
		expect(block.meta.listMarker).toBe('42.');
	});

	it('classifies HR with all three characters', () => {
		for (const raw of ['---', '***', '___', '- - -', '* * *', '_ _ _', '---  ']) {
			expect(parseLine(raw).type).toBe('hr');
		}
	});

	it('distinguishes HR from unordered list item', () => {
		// `- item` is a list item, `- - -` is HR
		expect(parseLine('- item').type).toBe('list_item');
		expect(parseLine('- - -').type).toBe('hr');
	});

	it('classifies fenced code block open/body/close (backticks)', () => {
		const doc = '```js\nconst x = 1;\n```';
		const blocks = parseBlocks(doc);
		expect(blocks[0].type).toBe('code_fence_open');
		expect(blocks[0].meta.lang).toBe('js');
		expect(blocks[1].type).toBe('code_fence_body');
		expect(blocks[1].meta.lang).toBe('js');
		expect(blocks[2].type).toBe('code_fence_close');
		expect(blocks[2].meta.lang).toBe('js');
	});

	it('classifies fenced code block with tildes', () => {
		const doc = '~~~python\nprint("hi")\n~~~';
		const blocks = parseBlocks(doc);
		expect(blocks[0].type).toBe('code_fence_open');
		expect(blocks[0].meta.lang).toBe('python');
		expect(blocks[1].type).toBe('code_fence_body');
		expect(blocks[2].type).toBe('code_fence_close');
	});

	it('classifies paragraphs as catch-all', () => {
		expect(parseLine('Hello world').type).toBe('paragraph');
		expect(parseLine('Some text').type).toBe('paragraph');
	});
});

// ---------------------------------------------------------------------------
// parseBlocks — structural properties
// ---------------------------------------------------------------------------

describe('parseBlocks — structural properties', () => {
	it('assigns sequential lineIndex values', () => {
		const blocks = parseBlocks('line0\nline1\nline2');
		expect(blocks.map((b) => b.lineIndex)).toEqual([0, 1, 2]);
	});

	it('preserves exact raw string per line (no trailing newline)', () => {
		const blocks = parseBlocks('# Hello\n\n**world**');
		expect(blocks[0].raw).toBe('# Hello');
		expect(blocks[1].raw).toBe('');
		expect(blocks[2].raw).toBe('**world**');
	});

	it('always has a meta object (never undefined)', () => {
		const blocks = parseBlocks('text\n\n# h\n---');
		for (const b of blocks) {
			expect(b.meta).toBeDefined();
			expect(typeof b.meta).toBe('object');
		}
	});

	it('produces one block per source line including the trailing newline case', () => {
		// "a\n" splits into ['a', ''] → 2 blocks
		const blocks = parseBlocks('a\n');
		expect(blocks).toHaveLength(2);
		expect(blocks[1].type).toBe('blank');
	});

	it('handles empty string (single blank block)', () => {
		const blocks = parseBlocks('');
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe('blank');
		expect(blocks[0].raw).toBe('');
	});
});

// ---------------------------------------------------------------------------
// parseBlocks — fence state machine
// ---------------------------------------------------------------------------

describe('parseBlocks — fence state machine', () => {
	it('all lines inside a fence are code_fence_body', () => {
		const doc = '```\nline1\nline2\nline3\n```';
		const blocks = parseBlocks(doc);
		expect(blocks[1].type).toBe('code_fence_body');
		expect(blocks[2].type).toBe('code_fence_body');
		expect(blocks[3].type).toBe('code_fence_body');
	});

	it('closing fence must use the same character', () => {
		// Open with ``` but try to close with ~~~
		const doc = '```js\ncode\n~~~';
		const blocks = parseBlocks(doc);
		// The ~~~ does NOT close the backtick fence → it is body content
		expect(blocks[2].type).toBe('code_fence_body');
	});

	it('closing fence must be at least as long as the opening fence', () => {
		// Open with ```` but try to close with ```
		const doc = '````\ncode\n```';
		const blocks = parseBlocks(doc);
		expect(blocks[2].type).toBe('code_fence_body');
	});

	it('longer closing fence is valid', () => {
		const doc = '```\ncode\n````';
		const blocks = parseBlocks(doc);
		expect(blocks[2].type).toBe('code_fence_close');
	});

	it('handles unclosed fence gracefully — remaining lines are body', () => {
		const doc = '```\nline1\nline2';
		const blocks = parseBlocks(doc);
		expect(blocks[1].type).toBe('code_fence_body');
		expect(blocks[2].type).toBe('code_fence_body');
		// No code_fence_close block emitted
		expect(blocks.some((b) => b.type === 'code_fence_close')).toBe(false);
	});

	it('fence body carries the opening lang on every body line', () => {
		const doc = '```ts\nconst x = 1;\nconst y = 2;\n```';
		const blocks = parseBlocks(doc);
		for (const b of blocks) {
			expect(b.meta.lang).toBe('ts');
		}
	});

	it('fence with no language tag has empty lang string', () => {
		const doc = '```\ncode\n```';
		const blocks = parseBlocks(doc);
		expect(blocks[0].meta.lang).toBe('');
	});

	it('headings and other patterns inside a fence are body, not block types', () => {
		const doc = '```\n# not a heading\n- not a list\n```';
		const blocks = parseBlocks(doc);
		expect(blocks[1].type).toBe('code_fence_body');
		expect(blocks[2].type).toBe('code_fence_body');
	});

	it('HR pattern `---` inside a fence is body', () => {
		const doc = '```\n---\n```';
		const blocks = parseBlocks(doc);
		expect(blocks[1].type).toBe('code_fence_body');
	});
});

// ---------------------------------------------------------------------------
// parseBlocks — list item meta
// ---------------------------------------------------------------------------

describe('parseBlocks — list item meta', () => {
	it('tracks indent for nested unordered list items', () => {
		const two = parseLine('  - nested');
		expect(two.meta.indent).toBe(2);
		expect(two.meta.ordered).toBe(false);

		const four = parseLine('    - deep');
		expect(four.meta.indent).toBe(4);
	});

	it('tracks indent for nested ordered list items', () => {
		const block = parseLine('   1. item');
		expect(block.meta.indent).toBe(3);
		expect(block.meta.ordered).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// getBlockContentStart
// ---------------------------------------------------------------------------

describe('getBlockContentStart', () => {
	it('paragraph → 0', () => {
		expect(getBlockContentStart(parseLine('Hello'))).toBe(0);
	});

	it('blank → 0', () => {
		expect(getBlockContentStart(parseLine(''))).toBe(0);
	});

	it('heading — level N → N+1 when followed by space', () => {
		expect(getBlockContentStart(parseLine('# h1'))).toBe(2); // '# '
		expect(getBlockContentStart(parseLine('## h2'))).toBe(3); // '## '
		expect(getBlockContentStart(parseLine('###### h6'))).toBe(7); // '###### '
	});

	it('heading — lone hashes with no space → level chars only', () => {
		const block = parseLine('#');
		expect(getBlockContentStart(block)).toBe(1); // raw='#', raw[1]=undefined → no space
	});

	it('blockquote with space → 2', () => {
		expect(getBlockContentStart(parseLine('> text'))).toBe(2);
	});

	it('blockquote without space → 1', () => {
		expect(getBlockContentStart(parseLine('>text'))).toBe(1);
	});

	it('unordered list item — marker + space', () => {
		expect(getBlockContentStart(parseLine('- item'))).toBe(2);
		expect(getBlockContentStart(parseLine('* item'))).toBe(2);
		expect(getBlockContentStart(parseLine('+ item'))).toBe(2);
	});

	it('unordered list item with indent', () => {
		expect(getBlockContentStart(parseLine('  - nested'))).toBe(4); // '  - '
	});

	it('ordered list item', () => {
		expect(getBlockContentStart(parseLine('1. item'))).toBe(3); // '1. '
		expect(getBlockContentStart(parseLine('42. item'))).toBe(4); // '42. '
	});

	it('opaque blocks return raw.length', () => {
		const doc = '```js\nconst x = 1;\n```\n---';
		const blocks = parseBlocks(doc);
		const fenceOpen = /** @type {Block} */ (blocks.find((b) => b.type == 'code_fence_open'));
		const fenceBody = /** @type {Block} */ (blocks.find((b) => b.type == 'code_fence_body'));
		const fenceClose = /** @type {Block} */ (blocks.find((b) => b.type == 'code_fence_close'));
		const hr = /** @type {Block} */ (blocks.find((b) => b.type === 'hr'));

		expect(fenceOpen).toBeDefined();
		expect(fenceBody).toBeDefined();
		expect(fenceClose).toBeDefined();
		expect(hr).toBeDefined();

		expect(getBlockContentStart(fenceOpen)).toBe(fenceOpen.raw.length);
		expect(getBlockContentStart(fenceBody)).toBe(fenceBody.raw.length);
		expect(getBlockContentStart(fenceClose)).toBe(fenceClose.raw.length);
		expect(getBlockContentStart(hr)).toBe(hr.raw.length);
	});
});

// ---------------------------------------------------------------------------
// getBlockInlineRaw
// ---------------------------------------------------------------------------

describe('getBlockInlineRaw', () => {
	it('returns full raw for paragraph (no prefix)', () => {
		expect(getBlockInlineRaw(parseLine('Hello world'))).toBe('Hello world');
	});

	it('strips heading prefix', () => {
		expect(getBlockInlineRaw(parseLine('## My heading'))).toBe('My heading');
	});

	it('strips blockquote prefix', () => {
		expect(getBlockInlineRaw(parseLine('> quoted'))).toBe('quoted');
	});

	it('strips list item prefix', () => {
		expect(getBlockInlineRaw(parseLine('- item text'))).toBe('item text');
		expect(getBlockInlineRaw(parseLine('1. ordered'))).toBe('ordered');
	});

	it('returns empty string for opaque blocks', () => {
		const fence = parseBlocks('```\ncode\n```')[0];
		expect(getBlockInlineRaw(fence)).toBe('');
	});
});

// ---------------------------------------------------------------------------
// serializeBlocks
// ---------------------------------------------------------------------------

describe('serializeBlocks', () => {
	it('round-trips a multi-line document exactly', () => {
		const doc =
			'# Hello\n\n> A blockquote\n\n- list item\n1. ordered\n\n---\n\n```js\nconst x = 1;\n```';
		expect(serializeBlocks(parseBlocks(doc))).toBe(doc);
	});

	it('round-trips an empty string', () => {
		expect(serializeBlocks(parseBlocks(''))).toBe('');
	});

	it('round-trips a single line', () => {
		expect(serializeBlocks(parseBlocks('just a line'))).toBe('just a line');
	});
});

// ---------------------------------------------------------------------------
// createBlockParser — feature flags
// ---------------------------------------------------------------------------

describe('createBlockParser — feature flags', () => {
	it('heading: false → paragraph', () => {
		const { parseBlocks: pb } = createBlockParser({ heading: false });
		expect(pb('# Not heading')[0].type).toBe('paragraph');
	});

	it('blockquote: false → paragraph', () => {
		const { parseBlocks: pb } = createBlockParser({ blockquote: false });
		expect(pb('> Not quote')[0].type).toBe('paragraph');
	});

	it('list: false → ul and ol both become paragraph', () => {
		const { parseBlocks: pb } = createBlockParser({ list: false });
		expect(pb('- not list')[0].type).toBe('paragraph');
		expect(pb('1. not list')[0].type).toBe('paragraph');
	});

	it('hr: false → paragraph', () => {
		const { parseBlocks: pb } = createBlockParser({ hr: false });
		expect(pb('---')[0].type).toBe('paragraph');
	});

	it('codeFence: false → fence open is paragraph', () => {
		const { parseBlocks: pb } = createBlockParser({ codeFence: false });
		const blocks = pb('```js\ncode\n```');
		expect(blocks[0].type).toBe('paragraph');
		expect(blocks[1].type).toBe('paragraph');
		// Note: '```' alone is not an HR (needs 3+ of same char from HR_RE set)
		// but may be paragraph too
		expect(['paragraph', 'hr']).toContain(blocks[2].type);
	});

	it('codeFence: { chars: ["`"] } — disables tilde fence', () => {
		const { parseBlocks: pb } = createBlockParser({ codeFence: { chars: ['`'] } });

		// Backtick fence still works
		const bt = pb('```\ncode\n```');
		expect(bt[0].type).toBe('code_fence_open');
		expect(bt[1].type).toBe('code_fence_body');
		expect(bt[2].type).toBe('code_fence_close');

		// Tilde fence is now disabled
		const tilde = pb('~~~\ncode\n~~~');
		expect(tilde[0].type).toBe('paragraph');
		expect(tilde[1].type).toBe('paragraph');
	});

	it('all flags can be disabled simultaneously', () => {
		const { parseBlocks: pb } = createBlockParser({
			heading: false,
			codeFence: false,
			blockquote: false,
			list: false,
			hr: false,
		});
		for (const line of ['# h', '> q', '- l', '1. o', '---', '```']) {
			const type = pb(line)[0].type;
			expect(['paragraph', 'blank']).toContain(type);
		}
	});
});

// ---------------------------------------------------------------------------
// createBlockParser — custom rules
// ---------------------------------------------------------------------------

describe('createBlockParser — custom rules', () => {
	/** Simple callout rule: ":type: content" */
	const calloutRule = {
		type: 'callout',
		test(/** @type {string} */ line) {
			const m = line.match(/^:(\w+):(.*)/);
			if (!m) return null;
			return { kind: m[1], title: m[2].trim() };
		},
		contentStart(/** @type {string} */ line) {
			return line.indexOf(':', 1) + 2; // after ":type: "
		},
	};

	it('custom rule claims its lines with correct type', () => {
		const { parseBlocks: pb } = createBlockParser({ custom: [calloutRule] });
		const block = pb(':warning: Be careful')[0];
		expect(block.type).toBe('callout');
	});

	it('custom rule meta is returned verbatim', () => {
		const { parseBlocks: pb } = createBlockParser({ custom: [calloutRule] });
		const block = pb(':note: Hello world')[0];
		expect(block.meta.kind).toBe('note');
		expect(block.meta.title).toBe('Hello world');
	});

	it('custom rule returns true → empty meta object {}', () => {
		const rule = {
			type: 'marker',
			test: (/** @type {string} */ line) => line === '---MARKER---' || false,
		};
		const { parseBlocks: pb } = createBlockParser({ custom: [rule] });
		const block = pb('---MARKER---')[0];
		expect(block.type).toBe('marker');
		expect(block.meta).toEqual({});
	});

	it('non-matching custom rule falls through to built-in rules', () => {
		const { parseBlocks: pb } = createBlockParser({ custom: [calloutRule] });
		// Normal blockquote still works
		expect(pb('> quoted')[0].type).toBe('blockquote');
		expect(pb('# heading')[0].type).toBe('heading');
	});

	it('custom rules run before all built-in rules (priority)', () => {
		// This rule claims lines starting with `#` before the heading rule
		const grabHash = {
			type: 'grabbed',
			test: (/** @type {string} */ line) => line.startsWith('#'),
		};
		const { parseBlocks: pb } = createBlockParser({ custom: [grabHash] });
		expect(pb('# heading')[0].type).toBe('grabbed');
	});

	it('opaque custom rule → getBlockContentStart returns raw.length', () => {
		const frontmatter = {
			type: 'frontmatter',
			opaque: true,
			test: (/** @type {string} */ line, /** @type {BlockParseContext} */ ctx) =>
				ctx.lineIndex === 0 && line === '---',
		};
		const parser = createBlockParser({ custom: [frontmatter] });
		const block = parser.parseBlocks('---\ntitle: x\n---')[0];
		expect(block.type).toBe('frontmatter');
		expect(parser.getBlockContentStart(block)).toBe(block.raw.length);
	});

	it('non-opaque custom rule with contentStart function', () => {
		const parser = createBlockParser({ custom: [calloutRule] });
		const block = parser.parseBlocks(':tip: Hello world')[0];
		// ":tip: " → index of second ':' is 4, +2 = 6
		expect(parser.getBlockContentStart(block)).toBe(6);
		expect(parser.getBlockInlineRaw(block)).toBe('Hello world');
	});

	it('non-opaque custom rule with no contentStart → defaults to 0', () => {
		const rule = { type: 'custom', test: () => true };
		const parser = createBlockParser({ custom: [rule] });
		const block = parser.parseBlocks('some line')[0];
		expect(parser.getBlockContentStart(block)).toBe(0);
	});

	it('multiple custom rules — first match wins', () => {
		const r1 = { type: 'first', test: (/** @type {string} */ line) => line.startsWith('!') };
		const r2 = { type: 'second', test: (/** @type {string} */ line) => line.startsWith('!') };
		const { parseBlocks: pb } = createBlockParser({ custom: [r1, r2] });
		expect(pb('! bang')[0].type).toBe('first');
	});
});

// ---------------------------------------------------------------------------
// createBlockParser — factory isolation
// ---------------------------------------------------------------------------

describe('createBlockParser — factory isolation', () => {
	it('two parsers with different configs produce independent results', () => {
		const noHeadings = createBlockParser({ heading: false });
		const withHeadings = createBlockParser({ heading: true });

		expect(noHeadings.parseBlocks('# h')[0].type).toBe('paragraph');
		expect(withHeadings.parseBlocks('# h')[0].type).toBe('heading');
	});

	it('serializeBlocks is a utility, not config-dependent', () => {
		const parser = createBlockParser({ heading: false });
		const raw = '# h\n\ntext';
		expect(parser.serializeBlocks(parser.parseBlocks(raw))).toBe(raw);
	});
});
