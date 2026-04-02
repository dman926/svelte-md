// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createTokenElement, patchLine, patchEditor } from './patcher';
import { TOKEN_ATTR } from '../cursor/types';
import { tok, blk, TYPE_ATTR } from '$lib/test-helpers';

/** @import { InlineToken } from '../parser/types'; */

// ---------------------------------------------------------------------------
// createTokenElement
// ---------------------------------------------------------------------------

describe('createTokenElement', () => {
	it('text → <span>', () => {
		const el = createTokenElement(tok('text', 'hi', 'hi', 0));
		expect(el.tagName).toBe('SPAN');
	});

	it('bold → <strong>', () => {
		const el = createTokenElement(tok('bold', '**hi**', 'hi', 0));
		expect(el.tagName).toBe('STRONG');
	});

	it('italic → <em>', () => {
		const el = createTokenElement(tok('italic', '*hi*', 'hi', 0));
		expect(el.tagName).toBe('EM');
	});

	it('code → <code>', () => {
		const el = createTokenElement(tok('code', '`hi`', 'hi', 0));
		expect(el.tagName).toBe('CODE');
	});

	it('strike → <s>', () => {
		const el = createTokenElement(tok('strike', '~~hi~~', 'hi', 0));
		expect(el.tagName).toBe('S');
	});

	it('link → <span> (not <a>)', () => {
		const t = { ...tok('link', '[a](b)', 'a', 0), href: 'b' };
		expect(createTokenElement(t).tagName).toBe('SPAN');
	});

	it('image → <span>', () => {
		const t = { ...tok('image', '![a](b)', 'a', 0), alt: 'a', href: 'b' };
		expect(createTokenElement(t).tagName).toBe('SPAN');
	});

	it('escape → <span>', () => {
		expect(createTokenElement(tok('escape', '\\*', '*', 0)).tagName).toBe('SPAN');
	});

	it('custom token → <span>', () => {
		expect(createTokenElement(tok('mention', '@alice', 'alice', 0)).tagName).toBe('SPAN');
	});

	it('sets data-md-token to token.start', () => {
		const el = createTokenElement(tok('text', 'hello', 'hello', 7));
		expect(el.getAttribute(TOKEN_ATTR)).toBe('7');
	});

	it('sets data-md-type to token.type', () => {
		const el = createTokenElement(tok('bold', '**hi**', 'hi', 0));
		expect(el.getAttribute(TYPE_ATTR)).toBe('bold');
	});

	it('sets textContent to token.content', () => {
		const el = createTokenElement(tok('text', 'hello world', 'hello world', 0));
		expect(el.textContent).toBe('hello world');
	});
});

// ---------------------------------------------------------------------------
// patchLine — blank
// ---------------------------------------------------------------------------

describe('patchLine — blank', () => {
	it('sets a single <br> child on an empty element', () => {
		const lineEl = document.createElement('div');
		patchLine(lineEl, blk('blank', '', 0), []);
		expect(lineEl.childNodes.length).toBe(1);
		expect(lineEl.firstChild?.nodeName).toBe('BR');
	});

	it('replaces existing content with <br>', () => {
		const lineEl = document.createElement('div');
		lineEl.textContent = 'old content';
		patchLine(lineEl, blk('blank', '', 0), []);
		expect(lineEl.textContent).toBe('');
		expect(lineEl.querySelector('br')).not.toBeNull();
	});

	it('no-ops when already has exactly one <br>', () => {
		const lineEl = document.createElement('div');
		const br = document.createElement('br');
		lineEl.appendChild(br);
		patchLine(lineEl, blk('blank', '', 0), []);
		// Same <br> element — no replacement
		expect(lineEl.firstChild).toBe(br);
	});

	it('replaces when there are multiple children even if first is <br>', () => {
		const lineEl = document.createElement('div');
		lineEl.appendChild(document.createElement('br'));
		lineEl.appendChild(document.createElement('span'));
		patchLine(lineEl, blk('blank', '', 0), []);
		expect(lineEl.childNodes.length).toBe(1);
		expect(lineEl.firstChild?.nodeName).toBe('BR');
	});
});

// ---------------------------------------------------------------------------
// patchLine — opaque
// ---------------------------------------------------------------------------

describe('patchLine — opaque', () => {
	for (const type of ['hr', 'code_fence_open', 'code_fence_body', 'code_fence_close']) {
		it(`${type}: sets a single text node with block.raw`, () => {
			const lineEl = document.createElement('div');
			patchLine(lineEl, blk(type, '---', 0), []);
			expect(lineEl.childNodes.length).toBe(1);
			expect(lineEl.firstChild?.nodeType).toBe(Node.TEXT_NODE);
			expect(lineEl.firstChild?.nodeValue).toBe('---');
		});
	}

	it('opaque: updates existing text node in place (same node reference)', () => {
		const lineEl = document.createElement('div');
		const tn = document.createTextNode('old content');
		lineEl.appendChild(tn);
		patchLine(lineEl, blk('code_fence_body', 'new content', 0), []);
		// Same text node, updated in place
		expect(lineEl.firstChild).toBe(tn);
		expect(tn.nodeValue).toBe('new content');
	});

	it('opaque: no-op when text node content is unchanged', () => {
		const lineEl = document.createElement('div');
		const tn = document.createTextNode('const x = 1;');
		lineEl.appendChild(tn);
		patchLine(lineEl, blk('code_fence_body', 'const x = 1;', 0), []);
		expect(lineEl.firstChild).toBe(tn);
		expect(tn.nodeValue).toBe('const x = 1;');
	});

	it('opaque: replaces element children with text node', () => {
		const lineEl = document.createElement('div');
		lineEl.appendChild(document.createElement('span')); // wrong structure
		patchLine(lineEl, blk('hr', '---', 0), []);
		expect(lineEl.firstChild?.nodeType).toBe(Node.TEXT_NODE);
		expect(lineEl.firstChild?.nodeValue).toBe('---');
	});
});

// ---------------------------------------------------------------------------
// patchLine — tokenized (element reuse)
// ---------------------------------------------------------------------------

describe('patchLine — tokenized: element identity reuse', () => {
	it('same-type token at same position: element is reused (same reference)', () => {
		const lineEl = document.createElement('div');
		const oldToken = tok('text', 'hello', 'hello', 0);
		patchLine(lineEl, blk('paragraph', 'hello', 0), [oldToken]);
		const original = lineEl.children[0];

		const newToken = tok('text', 'world', 'world', 0);
		patchLine(lineEl, blk('paragraph', 'world', 0), [newToken]);

		// Same element, updated content
		expect(lineEl.children[0]).toBe(original);
		expect(lineEl.children[0].textContent).toBe('world');
	});

	it('different-type token at same position: element is replaced', () => {
		const lineEl = document.createElement('div');
		patchLine(lineEl, blk('paragraph', '*hi*', 0), [tok('italic', '*hi*', 'hi', 0)]);
		const original = lineEl.children[0];

		patchLine(lineEl, blk('paragraph', '**hi**', 0), [tok('bold', '**hi**', 'hi', 0)]);

		expect(lineEl.children[0]).not.toBe(original);
		expect(lineEl.children[0].tagName).toBe('STRONG');
	});

	it('token start attribute updated when token shifts', () => {
		const lineEl = document.createElement('div');
		patchLine(lineEl, blk('paragraph', 'Xhello', 0), [tok('text', 'hello', 'hello', 1)]);
		const el = lineEl.children[0];
		expect(el.getAttribute(TOKEN_ATTR)).toBe('1');

		// After inserting 'Y' before, token shifts to start=2
		patchLine(lineEl, blk('paragraph', 'XYhello', 0), [tok('text', 'hello', 'hello', 2)]);
		expect(lineEl.children[0]).toBe(el);
		expect(el.getAttribute(TOKEN_ATTR)).toBe('2');
	});

	it('multiple same-type tokens: all reused', () => {
		const lineEl = document.createElement('div');
		const tokens1 = [tok('text', 'Hello ', 'Hello ', 0), tok('text', 'world', 'world', 6)];
		patchLine(lineEl, blk('paragraph', 'Hello world', 0), tokens1);
		const [el0, el1] = [...lineEl.children];

		const tokens2 = [tok('text', 'Hi ', 'Hi ', 0), tok('text', 'earth', 'earth', 3)];
		patchLine(lineEl, blk('paragraph', 'Hi earth', 0), tokens2);

		expect(lineEl.children[0]).toBe(el0);
		expect(lineEl.children[1]).toBe(el1);
		expect(el0.textContent).toBe('Hi ');
		expect(el1.textContent).toBe('earth');
	});
});

// ---------------------------------------------------------------------------
// patchLine — tokenized (count changes)
// ---------------------------------------------------------------------------

describe('patchLine — tokenized: count changes', () => {
	it('more tokens than before: new elements appended', () => {
		const lineEl = document.createElement('div');
		patchLine(lineEl, blk('paragraph', 'hello', 0), [tok('text', 'hello', 'hello', 0)]);
		expect(lineEl.children.length).toBe(1);

		patchLine(lineEl, blk('paragraph', 'hello world', 0), [
			tok('text', 'hello ', 'hello ', 0),
			tok('text', 'world', 'world', 6),
		]);
		expect(lineEl.children.length).toBe(2);
	});

	it('fewer tokens than before: surplus elements removed', () => {
		const lineEl = document.createElement('div');
		patchLine(lineEl, blk('paragraph', 'a b', 0), [
			tok('text', 'a ', 'a ', 0),
			tok('text', 'b', 'b', 2),
		]);
		expect(lineEl.children.length).toBe(2);

		patchLine(lineEl, blk('paragraph', 'a', 0), [tok('text', 'a', 'a', 0)]);
		expect(lineEl.children.length).toBe(1);
		expect(lineEl.children[0].textContent).toBe('a');
	});

	it('empty token array: removes all children', () => {
		const lineEl = document.createElement('div');
		patchLine(lineEl, blk('paragraph', 'hi', 0), [tok('text', 'hi', 'hi', 0)]);
		patchLine(lineEl, blk('paragraph', '', 0), []);
		expect(lineEl.children.length).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// patchLine — custom createElement option
// ---------------------------------------------------------------------------

describe('patchLine — custom createElement', () => {
	it('uses the provided factory instead of createTokenElement', () => {
		const lineEl = document.createElement('div');
		const token = tok('text', 'hello', 'hello', 0);
		const customEl = document.createElement('mark');
		customEl.setAttribute(TOKEN_ATTR, '0');
		customEl.setAttribute(TYPE_ATTR, 'text');
		customEl.textContent = 'hello';

		patchLine(lineEl, blk('paragraph', 'hello', 0), [token], {
			createElement: () => customEl,
		});

		expect(lineEl.children[0].tagName).toBe('MARK');
	});

	it('custom factory called once per new token', () => {
		const lineEl = document.createElement('div');
		/** @type {Array<InlineToken['type']>} */
		const calls = [];
		const factory = (/** @type {InlineToken} */ token) => {
			calls.push(token.type);
			const el = document.createElement('span');
			el.setAttribute(TOKEN_ATTR, String(token.start));
			el.setAttribute(TYPE_ATTR, token.type);
			el.textContent = token.content;
			return el;
		};

		patchLine(
			lineEl,
			blk('paragraph', 'hi there', 0),
			[tok('text', 'hi ', 'hi ', 0), tok('bold', '**there**', 'there', 3)],
			{ createElement: factory },
		);

		expect(calls).toEqual(['text', 'bold']);
	});

	it('custom factory not called for reused elements', () => {
		const lineEl = document.createElement('div');
		let callCount = 0;
		const factory = (/** @type {InlineToken} */ token) => {
			callCount++;
			const el = document.createElement('span');
			el.setAttribute(TOKEN_ATTR, String(token.start));
			el.setAttribute(TYPE_ATTR, token.type);
			el.textContent = token.content;
			return el;
		};

		const token = tok('text', 'hello', 'hello', 0);
		patchLine(lineEl, blk('paragraph', 'hello', 0), [token], { createElement: factory });
		expect(callCount).toBe(1);

		// Same type → element reused, factory not called again
		patchLine(lineEl, blk('paragraph', 'world', 0), [tok('text', 'world', 'world', 0)], {
			createElement: factory,
		});
		expect(callCount).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// patchEditor
// ---------------------------------------------------------------------------

describe('patchEditor', () => {
	function buildEditor(/** @type {number} */ lineCount) {
		const editor = document.createElement('div');
		for (let i = 0; i < lineCount; i++) {
			const lineEl = document.createElement('div');
			lineEl.setAttribute('data-md-line', String(i));
			editor.appendChild(lineEl);
		}
		return editor;
	}

	it('changedLineIndices=null patches all lines', () => {
		const editor = buildEditor(3);
		const blocks = [blk('paragraph', 'a', 0), blk('paragraph', 'b', 1), blk('paragraph', 'c', 2)];
		const tokensByLine = [
			[tok('text', 'a', 'a', 0)],
			[tok('text', 'b', 'b', 0)],
			[tok('text', 'c', 'c', 0)],
		];

		patchEditor(editor, blocks, tokensByLine, null);

		for (let i = 0; i < 3; i++) {
			const lineEl = editor.querySelector(`[data-md-line="${i}"]`);
			expect(lineEl?.children.length).toBeGreaterThan(0);
		}
	});

	it('changedLineIndices Set: only patches specified lines', () => {
		const editor = buildEditor(3);
		const blocks = [blk('paragraph', 'a', 0), blk('paragraph', 'b', 1), blk('paragraph', 'c', 2)];
		const tokensByLine = [
			[tok('text', 'a', 'a', 0)],
			[tok('text', 'b', 'b', 0)],
			[tok('text', 'c', 'c', 0)],
		];

		// Only patch line 1
		patchEditor(editor, blocks, tokensByLine, new Set([1]));

		const line0 = editor.querySelector('[data-md-line="0"]');
		const line1 = editor.querySelector('[data-md-line="1"]');
		const line2 = editor.querySelector('[data-md-line="2"]');

		expect(line0?.children.length).toBe(0); // untouched
		expect(line1?.children.length).toBeGreaterThan(0); // patched
		expect(line2?.children.length).toBe(0); // untouched
	});

	it('silently skips lines whose elements are not in the DOM', () => {
		const editor = buildEditor(1); // only line 0 exists
		const blocks = [
			blk('paragraph', 'a', 0),
			blk('paragraph', 'missing', 1), // no DOM element
		];
		const tokensByLine = [[tok('text', 'a', 'a', 0)], [tok('text', 'missing', 'missing', 0)]];

		expect(() => patchEditor(editor, blocks, tokensByLine, null)).not.toThrow();
	});

	it('missing tokensByLine entry defaults to empty array (opaque treated as no tokens)', () => {
		const editor = buildEditor(1);
		const blocks = [blk('paragraph', 'hi', 0)];
		/** @type {InlineToken[][]} */
		const tokensByLine = []; // no entry for line 0

		// Should not throw; will produce an empty line ([] tokens)
		expect(() => patchEditor(editor, blocks, tokensByLine, null)).not.toThrow();
	});
});
