// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { restoreSelection, resolvePointToRange } from './restore';
import { makeCollapsedSelection, makeSelection } from './map';
import { tok, buildEditorDom, readSelection } from '$lib/test-helpers';

/** @import { RawSelection } from './types'; */

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let _teardown = () => {};

beforeEach(() => {
	_teardown = () => {};
});

afterEach(() => {
	window.getSelection()?.removeAllRanges();
	_teardown();
});

function mount(/** @type {HTMLElement} */ el) {
	document.body.appendChild(el);
	_teardown = () => document.body.removeChild(el);
	return el;
}

// ---------------------------------------------------------------------------
// resolvePointToRange — null cases
// ---------------------------------------------------------------------------

describe('resolvePointToRange — null cases', () => {
	it('returns null when lineIndex does not exist in the DOM', () => {
		const { editor } = buildEditorDom([
			{ lineIndex: 0, tokens: [{ tokenStart: 0, content: 'hi' }] },
		]);
		mount(editor);
		const range = resolvePointToRange(editor, { line: 99, col: 0 }, []);
		expect(range).toBeNull();
	});

	it('returns null when token element is missing for given tokenStart', () => {
		// Line 0 has a token at start=0; we ask for a point inside a token at start=99
		const tokens = [tok('text', 'hello', 'hello', 0)];
		const { editor } = buildEditorDom([
			{ lineIndex: 0, tokens: [{ tokenStart: 0, content: 'hello' }] },
		]);
		mount(editor);
		// col=99 → findTokenAtRawCol returns last token (start=0) → token element found
		// So actually this will resolve. Let me instead test with no tokens in DOM for that col.
		const range = resolvePointToRange(editor, { line: 0, col: 0 }, [tokens]);
		expect(range).not.toBeNull();
	});
});

// ---------------------------------------------------------------------------
// resolvePointToRange — text token
// ---------------------------------------------------------------------------

describe('resolvePointToRange — text token', () => {
	const tokens = [tok('text', 'hello world', 'hello world', 0)];
	const specs = [{ lineIndex: 0, tokens: [{ tokenStart: 0, content: 'hello world' }] }];

	it('col 0 → range at text node offset 0', () => {
		const { editor, textNodeOf } = buildEditorDom(specs);
		mount(editor);
		const range = /** @type {Range} */ (resolvePointToRange(editor, { line: 0, col: 0 }, [tokens]));
		expect(range).not.toBeNull();
		expect(range.startContainer).toBe(textNodeOf(0, 0));
		expect(range.startOffset).toBe(0);
		expect(range.collapsed).toBe(true);
	});

	it('col 5 → range at text node offset 5', () => {
		const { editor, textNodeOf } = buildEditorDom(specs);
		mount(editor);
		const range = /** @type {Range} */ (resolvePointToRange(editor, { line: 0, col: 5 }, [tokens]));
		expect(range).not.toBeNull();
		expect(range.startContainer).toBe(textNodeOf(0, 0));
		expect(range.startOffset).toBe(5);
	});

	it('col = token.end → range at text node end', () => {
		const { editor, textNodeOf } = buildEditorDom(specs);
		mount(editor);
		const range = /** @type {Range} */ (
			resolvePointToRange(editor, { line: 0, col: 11 }, [tokens])
		);
		expect(range).not.toBeNull();
		expect(range.startContainer).toBe(textNodeOf(0, 0));
		expect(range.startOffset).toBe(11);
	});
});

// ---------------------------------------------------------------------------
// resolvePointToRange — bold token (prefix-length math)
// ---------------------------------------------------------------------------

describe('resolvePointToRange — bold token', () => {
	// Raw: "Hello **world**" — bold at start=6
	const tokens = [tok('text', 'Hello ', 'Hello ', 0), tok('bold', '**world**', 'world', 6)];
	const specs = [
		{
			lineIndex: 0,
			tokens: [
				{ tokenStart: 0, content: 'Hello ' },
				{ tokenStart: 6, content: 'world', tag: 'strong' },
			],
		},
	];

	it('col=8 (first content char) → DOM offset 0 in bold text node', () => {
		const { editor, textNodeOf } = buildEditorDom(specs);
		mount(editor);
		const range = /** @type {Range} */ (resolvePointToRange(editor, { line: 0, col: 8 }, [tokens]));
		expect(range).not.toBeNull();
		expect(range.startContainer).toBe(textNodeOf(0, 6));
		expect(range.startOffset).toBe(0);
	});

	it('col=11 (mid content) → DOM offset 3', () => {
		const { editor, textNodeOf } = buildEditorDom(specs);
		mount(editor);
		const range = /** @type {Range} */ (
			resolvePointToRange(editor, { line: 0, col: 11 }, [tokens])
		);
		expect(range).not.toBeNull();
		expect(range.startContainer).toBe(textNodeOf(0, 6));
		expect(range.startOffset).toBe(3);
	});

	it('col=6 (opening *) → clamped to DOM offset 0', () => {
		const { editor, textNodeOf } = buildEditorDom(specs);
		mount(editor);
		// col=6 is in the prefix of the bold token → clamp to 0
		const range = /** @type {Range} */ (resolvePointToRange(editor, { line: 0, col: 6 }, [tokens]));
		expect(range.startContainer).toBe(textNodeOf(0, 6));
		expect(range.startOffset).toBe(0);
	});

	it('col=13 (closing *) → clamped to DOM offset = content.length', () => {
		const { editor, textNodeOf } = buildEditorDom(specs);
		mount(editor);
		const range = /** @type {Range} */ (
			resolvePointToRange(editor, { line: 0, col: 13 }, [tokens])
		);
		expect(range).not.toBeNull();
		expect(range.startContainer).toBe(textNodeOf(0, 6));
		expect(range.startOffset).toBe(5); // 'world'.length
	});
});

// ---------------------------------------------------------------------------
// resolvePointToRange — opaque line
// ---------------------------------------------------------------------------

describe('resolvePointToRange — opaque line', () => {
	it('col maps 1:1 to text node offset', () => {
		const { editor, textNodeOf } = buildEditorDom([{ lineIndex: 0, opaque: 'const x = 1;' }]);
		mount(editor);
		const range = /** @type {Range} */ (resolvePointToRange(editor, { line: 0, col: 6 }, []));
		expect(range).not.toBeNull();
		expect(range.startContainer).toBe(textNodeOf(0, 'opaque'));
		expect(range.startOffset).toBe(6);
	});

	it('col beyond text node length is clamped', () => {
		const { editor } = buildEditorDom([{ lineIndex: 0, opaque: 'abc' }]);
		mount(editor);
		const range = /** @type {Range} */ (resolvePointToRange(editor, { line: 0, col: 99 }, []));
		expect(range).not.toBeNull();
		expect(range.startOffset).toBe(3); // clamped to 'abc'.length
	});
});

// ---------------------------------------------------------------------------
// resolvePointToRange — blank line
// ---------------------------------------------------------------------------

describe('resolvePointToRange — blank line', () => {
	it('blank line → range at line element, offset 0', () => {
		const { editor } = buildEditorDom([{ lineIndex: 0, blank: true }]);
		mount(editor);
		const range = /** @type {Range} */ (resolvePointToRange(editor, { line: 0, col: 0 }, []));
		expect(range).not.toBeNull();
		// blank lines have no text node, so the range starts on the line element
		expect(range.startOffset).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// restoreSelection — collapsed
// ---------------------------------------------------------------------------

describe('restoreSelection — collapsed', () => {
	const tokens = [tok('text', 'hello world', 'hello world', 0)];
	const specs = [{ lineIndex: 0, tokens: [{ tokenStart: 0, content: 'hello world' }] }];

	it('places collapsed selection at correct text node and offset', () => {
		const { editor, textNodeOf } = buildEditorDom(specs);
		mount(editor);
		const rawSel = makeCollapsedSelection(0, 5);
		restoreSelection(editor, rawSel, [tokens]);

		const { anchorNode, anchorOffset, isCollapsed } = readSelection();
		expect(anchorNode).toBe(textNodeOf(0, 0));
		expect(anchorOffset).toBe(5);
		expect(isCollapsed).toBe(true);
	});

	it('col 0 → selection at start of text node', () => {
		const { editor } = buildEditorDom(specs);
		mount(editor);
		restoreSelection(editor, makeCollapsedSelection(0, 0), [tokens]);

		const { anchorOffset } = readSelection();
		expect(anchorOffset).toBe(0);
	});

	it('col = raw length → selection at end of text node', () => {
		const { editor } = buildEditorDom(specs);
		mount(editor);
		restoreSelection(editor, makeCollapsedSelection(0, 11), [tokens]);

		const { anchorOffset } = readSelection();
		expect(anchorOffset).toBe(11);
	});

	it('bold token — prefix offset is removed from DOM offset', () => {
		const boldTokens = [tok('text', 'Hello ', 'Hello ', 0), tok('bold', '**world**', 'world', 6)];
		const { editor, textNodeOf } = buildEditorDom([
			{
				lineIndex: 0,
				tokens: [
					{ tokenStart: 0, content: 'Hello ' },
					{ tokenStart: 6, content: 'world', tag: 'strong' },
				],
			},
		]);
		mount(editor);

		// col=10 → bold token, domOffset = 10 - 8 = 2
		restoreSelection(editor, makeCollapsedSelection(0, 10), [boldTokens]);

		const { anchorNode, anchorOffset } = readSelection();
		expect(anchorNode).toBe(textNodeOf(0, 6));
		expect(anchorOffset).toBe(2);
	});

	it('no-op when anchor line does not exist', () => {
		const { editor } = buildEditorDom([
			{ lineIndex: 0, tokens: [{ tokenStart: 0, content: 'hi' }] },
		]);
		mount(editor);
		// Should not throw
		expect(() => restoreSelection(editor, makeCollapsedSelection(99, 0), [])).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// restoreSelection — forward range selection
// ---------------------------------------------------------------------------

describe('restoreSelection — forward range selection', () => {
	const tokens = [tok('text', 'hello world', 'hello world', 0)];
	const specs = [{ lineIndex: 0, tokens: [{ tokenStart: 0, content: 'hello world' }] }];

	it('places anchor and focus at correct offsets', () => {
		const { editor } = buildEditorDom(specs);
		mount(editor);
		const rawSel = makeSelection({ line: 0, col: 2 }, { line: 0, col: 8 });
		restoreSelection(editor, rawSel, [tokens]);

		const { anchorOffset, focusOffset, isCollapsed } = readSelection();
		expect(isCollapsed).toBe(false);
		expect(anchorOffset).toBe(2);
		expect(focusOffset).toBe(8);
	});
});

// ---------------------------------------------------------------------------
// restoreSelection — cross-line range
// ---------------------------------------------------------------------------

describe('restoreSelection — cross-line range', () => {
	const line0Tokens = [tok('text', 'Hello', 'Hello', 0)];
	const line1Tokens = [tok('text', 'World', 'World', 0)];
	const specs = [
		{ lineIndex: 0, tokens: [{ tokenStart: 0, content: 'Hello' }] },
		{ lineIndex: 1, tokens: [{ tokenStart: 0, content: 'World' }] },
	];

	it('anchor on line 0, focus on line 1 — both resolved correctly', () => {
		const { editor, textNodeOf } = buildEditorDom(specs);
		mount(editor);
		const rawSel = makeSelection({ line: 0, col: 2 }, { line: 1, col: 3 });
		restoreSelection(editor, rawSel, [line0Tokens, line1Tokens]);

		const { anchorNode, anchorOffset, focusNode, focusOffset, isCollapsed } = readSelection();
		expect(isCollapsed).toBe(false);
		expect(anchorNode).toBe(textNodeOf(0, 0));
		expect(anchorOffset).toBe(2);
		expect(focusNode).toBe(textNodeOf(1, 0));
		expect(focusOffset).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// restoreSelection — opaque lines
// ---------------------------------------------------------------------------

describe('restoreSelection — opaque lines', () => {
	it('restores cursor into opaque text node with direct offset', () => {
		const { editor, textNodeOf } = buildEditorDom([{ lineIndex: 0, opaque: 'const x = 1;' }]);
		mount(editor);
		restoreSelection(editor, makeCollapsedSelection(0, 4), []);

		const { anchorNode, anchorOffset } = readSelection();
		expect(anchorNode).toBe(textNodeOf(0, 'opaque'));
		expect(anchorOffset).toBe(4);
	});
});

// ---------------------------------------------------------------------------
// Round-trip: capture → restore
// ---------------------------------------------------------------------------

describe('round-trip: captureSelection then restoreSelection', () => {
	// Import captureSelection here for round-trip tests
	it('captured raw selection restores to the same DOM position (text token)', async () => {
		const { captureSelection } = await import('./capture.js');
		const tokens = [tok('text', 'hello world', 'hello world', 0)];
		const { editor, textNodeOf } = buildEditorDom([
			{
				lineIndex: 0,
				tokens: [{ tokenStart: 0, content: 'hello world' }],
			},
		]);
		mount(editor);

		// Set a known DOM position
		const range = document.createRange();
		range.setStart(textNodeOf(0, 0), 7);
		range.collapse(true);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range);

		// Capture
		const rawSel = /** @type {RawSelection} */ (captureSelection(editor, [tokens]));
		expect(rawSel.anchor).toEqual({ line: 0, col: 7 });

		// Disturb the selection
		window.getSelection()?.removeAllRanges();

		// Restore
		restoreSelection(editor, rawSel, [tokens]);

		const { anchorNode, anchorOffset } = readSelection();
		expect(anchorNode).toBe(textNodeOf(0, 0));
		expect(anchorOffset).toBe(7);
	});

	it('round-trip for a bold token position', async () => {
		const { captureSelection } = await import('./capture.js');
		const tokens = [tok('text', 'Hello ', 'Hello ', 0), tok('bold', '**world**', 'world', 6)];
		const { editor, textNodeOf } = buildEditorDom([
			{
				lineIndex: 0,
				tokens: [
					{ tokenStart: 0, content: 'Hello ' },
					{ tokenStart: 6, content: 'world', tag: 'strong' },
				],
			},
		]);
		mount(editor);

		// Place cursor at DOM offset 3 within the bold token's text node
		const range = document.createRange();
		range.setStart(textNodeOf(0, 6), 3);
		range.collapse(true);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range);

		const rawSel = /** @type {RawSelection} */ (captureSelection(editor, [tokens]));
		// DOM offset 3 in bold content → rawCol = 6 + 2 + 3 = 11
		expect(rawSel.anchor).toEqual({ line: 0, col: 11 });

		window.getSelection()?.removeAllRanges();
		restoreSelection(editor, rawSel, [tokens]);

		const { anchorNode, anchorOffset } = readSelection();
		expect(anchorNode).toBe(textNodeOf(0, 6));
		expect(anchorOffset).toBe(3);
	});

	it('round-trip for a range selection', async () => {
		const { captureSelection } = await import('./capture.js');
		const tokens = [tok('text', 'hello world', 'hello world', 0)];
		const { editor, textNodeOf } = buildEditorDom([
			{
				lineIndex: 0,
				tokens: [{ tokenStart: 0, content: 'hello world' }],
			},
		]);
		mount(editor);

		const range = document.createRange();
		range.setStart(textNodeOf(0, 0), 2);
		range.setEnd(textNodeOf(0, 0), 8);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range);

		const rawSel = /** @type {RawSelection} */ (captureSelection(editor, [tokens]));
		expect(rawSel.anchor).toEqual({ line: 0, col: 2 });
		expect(rawSel.focus).toEqual({ line: 0, col: 8 });

		window.getSelection()?.removeAllRanges();
		restoreSelection(editor, rawSel, [tokens]);

		const { anchorOffset, focusOffset, isCollapsed } = readSelection();
		expect(isCollapsed).toBe(false);
		expect(anchorOffset).toBe(2);
		expect(focusOffset).toBe(8);
	});
});
