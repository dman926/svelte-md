// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import MarkdownLine from './MarkdownLine.svelte';
import { TOKEN_ATTR, LINE_ATTR } from '../cursor/types';
import { tok, blk } from '$lib/test-helpers';

/** @import {ComponentProps} from 'svelte'; */

afterEach(() => cleanup());

/**
 * Render a MarkdownLine and return the container's first child (the line element).
 */
function renderLine(/** @type {ComponentProps<typeof MarkdownLine>} */ props) {
	const { container } = render(MarkdownLine, { props });
	// The component renders directly into container — first element child is the line el
	return container.firstElementChild;
}

// ---------------------------------------------------------------------------
// DOM contract attributes
// ---------------------------------------------------------------------------

describe('MarkdownLine — DOM contract attributes', () => {
	it('line element carries data-md-line with lineIndex', () => {
		const el = renderLine({
			block: blk('paragraph', 'hello', 3),
			tokens: [tok('text', 'hello', 'hello', 0)],
		});
		expect(el?.getAttribute(LINE_ATTR)).toBe('3');
	});

	it('line element carries data-md-block-type with block.type', () => {
		const el = renderLine({
			block: blk('heading', '# hi', 0, { level: 1 }),
			tokens: [tok('text', 'hi', 'hi', 2)],
		});
		expect(el?.getAttribute('data-md-block-type')).toBe('heading');
	});

	it('each token element carries data-md-token with token.start', () => {
		const el = renderLine({
			block: blk('paragraph', 'Hello **world**', 0),
			tokens: [tok('text', 'Hello ', 'Hello ', 0), tok('bold', '**world**', 'world', 6)],
		});
		const tokenEls = el?.querySelectorAll(`[${TOKEN_ATTR}]`) ?? [];
		const starts = [...tokenEls].map((t) => t.getAttribute(TOKEN_ATTR));
		expect(starts).toContain('0');
		expect(starts).toContain('6');
	});

	it('each token element carries data-md-type with token.type', () => {
		const el = renderLine({
			block: blk('paragraph', '**bold**', 0),
			tokens: [tok('bold', '**bold**', 'bold', 0)],
		});
		const tokenEl = el?.querySelector(`[${TOKEN_ATTR}="0"]`);
		expect(tokenEl?.getAttribute('data-md-type')).toBe('bold');
	});
});

// ---------------------------------------------------------------------------
// Default line tag and class
// ---------------------------------------------------------------------------

describe('MarkdownLine — lineTag and lineClass props', () => {
	it('default lineTag is div', () => {
		const el = renderLine({
			block: blk('paragraph', 'hi', 0),
			tokens: [],
		});
		expect(el?.tagName).toBe('DIV');
	});

	it('lineTag prop changes the container element', () => {
		const el = renderLine({
			block: blk('paragraph', 'hi', 0),
			tokens: [tok('text', 'hi', 'hi', 0)],
			lineTag: 'p',
		});
		expect(el?.tagName).toBe('P');
	});

	it('lineClass adds CSS class to container', () => {
		const el = renderLine({
			block: blk('paragraph', 'hi', 0),
			tokens: [],
			lineClass: 'my-line active',
		});
		expect(el?.classList.contains('my-line')).toBe(true);
		expect(el?.classList.contains('active')).toBe(true);
	});

	it('empty lineClass adds no class attribute', () => {
		const el = renderLine({
			block: blk('paragraph', 'hi', 0),
			tokens: [],
			lineClass: '',
		});
		// class attribute should be absent or empty
		expect(el?.getAttribute('class')).toBeFalsy();
	});
});

// ---------------------------------------------------------------------------
// Blank lines
// ---------------------------------------------------------------------------

describe('MarkdownLine — blank', () => {
	it('renders a <br> for blank blocks', () => {
		const el = renderLine({
			block: blk('blank', '', 0),
			tokens: [],
		});
		expect(el?.querySelector('br')).not.toBeNull();
	});

	it('blank line has no data-md-token elements', () => {
		const el = renderLine({
			block: blk('blank', '', 0),
			tokens: [],
		});
		expect(el?.querySelectorAll(`[${TOKEN_ATTR}]`).length).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Opaque blocks
// ---------------------------------------------------------------------------

describe('MarkdownLine — opaque blocks', () => {
	for (const type of ['hr', 'code_fence_open', 'code_fence_body', 'code_fence_close']) {
		it(`${type}: renders raw text, no data-md-token elements`, () => {
			const raw = type === 'hr' ? '---' : '```js';
			const el = renderLine({
				block: blk(type, raw, 0),
				tokens: [],
			});
			expect(el?.textContent).toBe(raw);
			expect(el?.querySelectorAll(`[${TOKEN_ATTR}]`).length).toBe(0);
		});
	}
});

// ---------------------------------------------------------------------------
// Default token rendering — element tags
// ---------------------------------------------------------------------------

describe('MarkdownLine — default token element tags', () => {
	function renderSingleToken(
		/** @type {string} */ type,
		/** @type {string} */ raw,
		/** @type {string} */ content,
		extra = {},
	) {
		return renderLine({
			block: blk('paragraph', raw, 0),
			tokens: [{ type, raw, content, start: 0, end: raw.length, ...extra }],
		});
	}

	it('text → <span>', () => {
		const el = renderSingleToken('text', 'hello', 'hello');
		expect(el?.querySelector('span[data-md-type="text"]')).not.toBeNull();
	});

	it('bold → <strong>', () => {
		const el = renderSingleToken('bold', '**hi**', 'hi');
		expect(el?.querySelector('strong[data-md-type="bold"]')).not.toBeNull();
		expect(el?.querySelector('strong')?.textContent).toBe('hi');
	});

	it('italic → <em>', () => {
		const el = renderSingleToken('italic', '*hi*', 'hi');
		expect(el?.querySelector('em[data-md-type="italic"]')).not.toBeNull();
	});

	it('code → <code>', () => {
		const el = renderSingleToken('code', '`fn()`', 'fn()');
		expect(el?.querySelector('code[data-md-type="code"]')).not.toBeNull();
	});

	it('strike → <s>', () => {
		const el = renderSingleToken('strike', '~~out~~', 'out');
		expect(el?.querySelector('s[data-md-type="strike"]')).not.toBeNull();
	});

	it('link → <span> (NOT <a>), content is label', () => {
		const el = renderSingleToken('link', '[hello](url)', 'hello', { href: 'url' });
		expect(el?.querySelector('a')).toBeNull();
		const span = el?.querySelector('span[data-md-type="link"]');
		expect(span).not.toBeNull();
		expect(span?.textContent).toBe('hello');
	});

	it('image → <span>, content is alt text', () => {
		const el = renderSingleToken('image', '![cat](c.png)', 'cat', { alt: 'cat', href: 'c.png' });
		expect(el?.querySelector('span[data-md-type="image"]')?.textContent).toBe('cat');
	});

	it('escape → <span>, content is escaped char', () => {
		const el = renderSingleToken('escape', '\\*', '*');
		expect(el?.querySelector('span[data-md-type="escape"]')?.textContent).toBe('*');
	});

	it('custom/unknown token → <span> with data-md-type set to custom type', () => {
		const el = renderSingleToken('mention', '@alice', 'alice');
		const span = el?.querySelector('[data-md-type="mention"]');
		expect(span).not.toBeNull();
		expect(span?.textContent).toBe('alice');
	});
});

// ---------------------------------------------------------------------------
// Token content is rendered from token.content (not token.raw)
// ---------------------------------------------------------------------------

describe('MarkdownLine — content rendering', () => {
	it('bold token shows content between delimiters, not raw syntax', () => {
		const el = renderLine({
			block: blk('paragraph', '**world**', 0),
			tokens: [tok('bold', '**world**', 'world', 0)],
		});
		const strong = el?.querySelector('strong');
		expect(strong?.textContent).toBe('world');
		// The ** markers must not appear in the rendered DOM
		expect(el?.textContent).not.toContain('**');
	});

	it('link shows label text, not the URL', () => {
		const el = renderLine({
			block: blk('paragraph', '[click](https://example.com)', 0),
			tokens: [
				{
					type: 'link',
					raw: '[click](https://example.com)',
					content: 'click',
					start: 0,
					end: 28,
					href: 'https://example.com',
				},
			],
		});
		expect(el?.textContent).toBe('click');
		expect(el?.textContent).not.toContain('https://');
	});
});

// ---------------------------------------------------------------------------
// Multiple tokens on one line
// ---------------------------------------------------------------------------

describe('MarkdownLine — multiple tokens', () => {
	it('renders correct number of token elements', () => {
		const tokens = [
			tok('text', 'Hello ', 'Hello ', 0),
			tok('bold', '**world**', 'world', 6),
			tok('text', '!', '!', 15),
		];
		const el = renderLine({
			block: blk('paragraph', 'Hello **world**!', 0),
			tokens,
		});
		expect(el?.querySelectorAll(`[${TOKEN_ATTR}]`).length).toBe(3);
	});

	it('token order in DOM matches token array order', () => {
		const tokens = [
			tok('italic', '*a*', 'a', 0),
			tok('text', ' ', ' ', 3),
			tok('bold', '**b**', 'b', 4),
		];
		const el = renderLine({
			block: blk('paragraph', '*a* **b**', 0),
			tokens,
		});
		const tokenEls = el?.querySelectorAll(`[${TOKEN_ATTR}]`);
		expect(tokenEls?.[0].getAttribute(TOKEN_ATTR)).toBe('0');
		expect(tokenEls?.[1].getAttribute(TOKEN_ATTR)).toBe('3');
		expect(tokenEls?.[2].getAttribute(TOKEN_ATTR)).toBe('4');
	});
});
