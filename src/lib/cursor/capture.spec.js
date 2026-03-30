// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { captureSelection } from './capture';
import { tok, buildEditorDom, setCollapsedSelection, setRangeSelection } from '$lib/test-helpers';
/** @import { RawSelection } from './types'; */

// ---------------------------------------------------------------------------
// Setup: every test attaches a fresh editor to the document body
// and tears it down afterwards so selections don't bleed between tests.
// ---------------------------------------------------------------------------

let teardown = () => {};

beforeEach(() => {
	teardown = () => {};
});

afterEach(() => {
	window.getSelection()?.removeAllRanges();
	teardown();
});

/**
 * Attach `editorEl` to document.body so `contains()` works, and register cleanup.
 * @param {HTMLElement} editorEl
 */
function mount(editorEl) {
	document.body.appendChild(editorEl);
	teardown = () => document.body.removeChild(editorEl);
	return editorEl;
}

// ---------------------------------------------------------------------------
// Null / no-selection cases
// ---------------------------------------------------------------------------

describe('captureSelection — null / no-selection', () => {
	it('returns null when there is no selection', () => {
		const { editor } = buildEditorDom([
			{ lineIndex: 0, tokens: [{ tokenStart: 0, tokenType: 'text', content: 'hello' }] },
		]);
		mount(editor);
		const sel = /** @type {Selection} */ (window.getSelection());
		expect(sel).toBeDefined();
		sel.removeAllRanges();
		expect(captureSelection(editor, [])).toBeNull();
	});

	it('returns null when the selection is outside editorEl', () => {
		const { editor } = buildEditorDom([
			{ lineIndex: 0, tokens: [{ tokenStart: 0, tokenType: 'text', content: 'hi' }] },
		]);
		mount(editor);

		// Create a node outside the editor and select it
		const outside = document.createElement('p');
		outside.appendChild(document.createTextNode('outside'));
		document.body.appendChild(outside);
		expect(outside.firstChild).toBeDefined();
		setCollapsedSelection(/** @type {Text} */ (outside.firstChild), 0);

		expect(captureSelection(editor, [])).toBeNull();
		document.body.removeChild(outside);
	});
});

// ---------------------------------------------------------------------------
// Text node in a tokenized line
// ---------------------------------------------------------------------------

describe('captureSelection — tokenized line, text node', () => {
	it('collapsed at start of text token → col = token.start', () => {
		const tokens = [tok('text', 'hello', 'hello', 0)];
		const { editor, textNodeOf } = buildEditorDom([
			{ lineIndex: 0, tokens: [{ tokenStart: 0, tokenType: 'text', content: 'hello' }] },
		]);
		mount(editor);

		setCollapsedSelection(textNodeOf(0, 0), 0);
		const sel = /** @type {RawSelection} */ (captureSelection(editor, [tokens]));

		expect(sel).not.toBeNull();
		expect(sel.isCollapsed).toBe(true);
		expect(sel.anchor).toEqual({ line: 0, col: 0 });
		expect(sel.focus).toEqual({ line: 0, col: 0 });
	});

	it('collapsed mid text token → col = offset', () => {
		const tokens = [tok('text', 'hello world', 'hello world', 0)];
		const { editor, textNodeOf } = buildEditorDom([
			{ lineIndex: 0, tokens: [{ tokenStart: 0, tokenType: 'text', content: 'hello world' }] },
		]);
		mount(editor);

		setCollapsedSelection(textNodeOf(0, 0), 5);
		const sel = /** @type {RawSelection} */ (captureSelection(editor, [tokens]));
		expect(sel).not.toBeNull();
		expect(sel.anchor).toEqual({ line: 0, col: 5 });
	});

	it('collapsed at end of text token → col = token.end', () => {
		const tokens = [tok('text', 'hello', 'hello', 0)];
		const { editor, textNodeOf } = buildEditorDom([
			{ lineIndex: 0, tokens: [{ tokenStart: 0, tokenType: 'text', content: 'hello' }] },
		]);
		mount(editor);

		setCollapsedSelection(textNodeOf(0, 0), 5);
		const sel = /** @type {RawSelection} */ (captureSelection(editor, [tokens]));
		expect(sel).not.toBeNull();
		expect(sel.anchor).toEqual({ line: 0, col: 5 });
	});
});

// ---------------------------------------------------------------------------
// Bold token — prefix-length math
// ---------------------------------------------------------------------------

describe('captureSelection — bold token prefix math', () => {
	// Raw: "Hello **world**!" → tokens at start=0 (text), start=6 (bold), start=15 (text)
	const tokens = [
		tok('text', 'Hello ', 'Hello ', 0),
		tok('bold', '**world**', 'world', 6),
		tok('text', '!', '!', 15),
	];
	const lineSpecs = [
		{
			lineIndex: 0,
			tokens: [
				{ tokenStart: 0, tokenType: 'text', content: 'Hello ' },
				{ tokenStart: 6, tokenType: 'bold', content: 'world', tag: 'strong' },
				{ tokenStart: 15, tokenType: 'text', content: '!' },
			],
		},
	];

	it('cursor at start of bold content (domOffset=0) → rawCol = token.start + prefixLen = 8', () => {
		const { editor, textNodeOf } = buildEditorDom(lineSpecs);
		mount(editor);
		setCollapsedSelection(textNodeOf(0, 6), 0);
		const sel = /** @type {RawSelection} */ (captureSelection(editor, [tokens]));
		expect(sel).not.toBeNull();
		expect(sel.anchor).toEqual({ line: 0, col: 8 }); // 6+2
	});

	it('cursor mid bold content (domOffset=3) → rawCol = 8+3 = 11', () => {
		const { editor, textNodeOf } = buildEditorDom(lineSpecs);
		mount(editor);
		setCollapsedSelection(textNodeOf(0, 6), 3);
		const sel = /** @type {RawSelection} */ (captureSelection(editor, [tokens]));
		expect(sel).not.toBeNull();
		expect(sel.anchor).toEqual({ line: 0, col: 11 });
	});

	it('cursor at end of bold content (domOffset=5) → rawCol = 13', () => {
		const { editor, textNodeOf } = buildEditorDom(lineSpecs);
		mount(editor);
		setCollapsedSelection(textNodeOf(0, 6), 5);
		const sel = /** @type {RawSelection} */ (captureSelection(editor, [tokens]));
		expect(sel).not.toBeNull();
		expect(sel.anchor).toEqual({ line: 0, col: 13 }); // 6+2+5
	});
});

// ---------------------------------------------------------------------------
// Opaque line (no token wrappers) — 1:1 DOM offset to raw col
// ---------------------------------------------------------------------------

describe('captureSelection — opaque line', () => {
	it('col = DOM text offset directly', () => {
		const { editor, textNodeOf } = buildEditorDom([{ lineIndex: 0, opaque: 'const x = 1;' }]);
		mount(editor);
		setCollapsedSelection(textNodeOf(0, 'opaque'), 6);
		// tokensByLine[0] is undefined → opaque treatment
		const sel = /** @type {RawSelection} */ (captureSelection(editor, []));
		expect(sel).not.toBeNull();
		expect(sel.anchor).toEqual({ line: 0, col: 6 });
	});

	it('col = 0 at start of opaque line', () => {
		const { editor, textNodeOf } = buildEditorDom([{ lineIndex: 0, opaque: 'code' }]);
		mount(editor);
		setCollapsedSelection(textNodeOf(0, 'opaque'), 0);
		const sel = /** @type {RawSelection} */ (captureSelection(editor, []));
		expect(sel).not.toBeNull();
		expect(sel.anchor).toEqual({ line: 0, col: 0 });
	});
});

// ---------------------------------------------------------------------------
// Blank line
// ---------------------------------------------------------------------------

describe('captureSelection — blank line', () => {
	it('selection on the line element itself → col 0', () => {
		const { editor, lineEl } = buildEditorDom([{ lineIndex: 1, blank: true }]);
		mount(editor);

		// Browser places selection on the line element when the line is blank
		const range = document.createRange();
		range.setStart(lineEl(1), 0);
		range.collapse(true);
		/** @type {Selection} */ (window.getSelection()).removeAllRanges();
		/** @type {Selection} */ (window.getSelection()).addRange(range);

		const sel = /** @type {RawSelection} */ (captureSelection(editor, []));
		expect(sel).not.toBeNull();
		expect(sel.anchor).toEqual({ line: 1, col: 0 });
	});
});

// ---------------------------------------------------------------------------
// Multi-line document
// ---------------------------------------------------------------------------

describe('captureSelection — multi-line document', () => {
	// Line 0: "Hello **world**" (tokenized)
	// Line 1: "" (blank)
	// Line 2: "const x = 1;" (opaque)
	const line0Tokens = [tok('text', 'Hello ', 'Hello ', 0), tok('bold', '**world**', 'world', 6)];
	const specs = [
		{
			lineIndex: 0,
			tokens: [
				{ tokenStart: 0, tokenType: 'text', content: 'Hello ' },
				{ tokenStart: 6, tokenType: 'bold', content: 'world' },
			],
		},
		{ lineIndex: 1, blank: true },
		{ lineIndex: 2, opaque: 'const x = 1;' },
	];
	const tokensByLine = [line0Tokens, null, null];

	it('cursor on line 0, text token', () => {
		const { editor, textNodeOf } = buildEditorDom(specs);
		mount(editor);
		setCollapsedSelection(textNodeOf(0, 0), 3);
		expect(/** @type {RawSelection} */ (captureSelection(editor, tokensByLine)).anchor).toEqual({
			line: 0,
			col: 3,
		});
	});

	it('cursor on line 2 (opaque)', () => {
		const { editor, textNodeOf } = buildEditorDom(specs);
		mount(editor);
		setCollapsedSelection(textNodeOf(2, 'opaque'), 4);
		expect(/** @type {RawSelection} */ (captureSelection(editor, tokensByLine)).anchor).toEqual({
			line: 2,
			col: 4,
		});
	});

	it('lineIndex is correct for each line', () => {
		const { editor, textNodeOf } = buildEditorDom(specs);
		mount(editor);
		setCollapsedSelection(textNodeOf(0, 6), 2);
		const sel0 = /** @type {RawSelection} */ (captureSelection(editor, tokensByLine));
		expect(sel0).not.toBeNull();
		expect(sel0.anchor.line).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Range (non-collapsed) selection
// ---------------------------------------------------------------------------

describe('captureSelection — range selections', () => {
	const tokens = [tok('text', 'Hello world', 'Hello world', 0)];
	const specs = [
		{ lineIndex: 0, tokens: [{ tokenStart: 0, tokenType: 'text', content: 'Hello world' }] },
	];

	it('forward range on same line', () => {
		const { editor, textNodeOf } = buildEditorDom(specs);
		mount(editor);
		setRangeSelection(textNodeOf(0, 0), 2, textNodeOf(0, 0), 7);
		const sel = /** @type {RawSelection} */ (captureSelection(editor, [tokens]));
		expect(sel).not.toBeNull();

		expect(sel.isCollapsed).toBe(false);
		expect(sel.anchor).toEqual({ line: 0, col: 2 });
		expect(sel.focus).toEqual({ line: 0, col: 7 });
	});

	it('isCollapsed is true for zero-length range', () => {
		const { editor, textNodeOf } = buildEditorDom(specs);
		mount(editor);
		setCollapsedSelection(textNodeOf(0, 0), 3);
		const sel = /** @type {RawSelection} */ (captureSelection(editor, [tokens]));
		expect(sel).not.toBeNull();
		expect(sel.isCollapsed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Cross-line range selection
// ---------------------------------------------------------------------------

describe('captureSelection — cross-line range', () => {
	const line0Tokens = [tok('text', 'Hello', 'Hello', 0)];
	const line1Tokens = [tok('text', 'World', 'World', 0)];
	const specs = [
		{ lineIndex: 0, tokens: [{ tokenStart: 0, tokenType: 'text', content: 'Hello' }] },
		{ lineIndex: 1, tokens: [{ tokenStart: 0, tokenType: 'text', content: 'World' }] },
	];

	it('anchor on line 0, focus on line 1', () => {
		const { editor, textNodeOf } = buildEditorDom(specs);
		mount(editor);
		setRangeSelection(textNodeOf(0, 0), 2, textNodeOf(1, 0), 3);
		const sel = /** @type {RawSelection} */ (captureSelection(editor, [line0Tokens, line1Tokens]));

		expect(sel).not.toBeNull();
		expect(sel.anchor).toEqual({ line: 0, col: 2 });
		expect(sel.focus).toEqual({ line: 1, col: 3 });
		expect(sel.isCollapsed).toBe(false);
	});
});
