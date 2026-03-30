// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as cursorIndex from './index';

/** @import { RawSelection } from './types'; */

// ---------------------------------------------------------------------------
// Public API surface
// ---------------------------------------------------------------------------

describe('cursor/index — public API surface', () => {
	const expectedExports = [
		// Constants
		'LINE_ATTR',
		'TOKEN_ATTR',
		// Pure math
		'getTokenPrefixLen',
		'rawColToDomOffset',
		'domOffsetToRawCol',
		'findTokenAtRawCol',
		'findTokenByStart',
		'makeCollapsedSelection',
		'makeSelection',
		'pointsEqual',
		'clampPoint',
		// DOM read
		'captureSelection',
		// DOM write
		'restoreSelection',
		'resolvePointToRange',
	];

	for (const name of expectedExports) {
		it(`exports "${name}"`, () => {
			expect(cursorIndex).toHaveProperty(name);
		});
	}

	it('exports exactly the expected set — no undocumented exports', () => {
		const actual = Object.keys(cursorIndex).sort();
		expect(actual).toEqual([...expectedExports].sort());
	});
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('cursor/index — constants', () => {
	it('LINE_ATTR is the correct attribute name', () => {
		expect(cursorIndex.LINE_ATTR).toBe('data-md-line');
	});

	it('TOKEN_ATTR is the correct attribute name', () => {
		expect(cursorIndex.TOKEN_ATTR).toBe('data-md-token');
	});
});

// ---------------------------------------------------------------------------
// Re-exports are the real implementations, not wrappers
// ---------------------------------------------------------------------------

describe('cursor/index — re-exports are the real implementations', () => {
	it('getTokenPrefixLen works correctly via the index', () => {
		const tok = { type: 'bold', raw: '**hi**', content: 'hi', start: 0, end: 6 };
		expect(cursorIndex.getTokenPrefixLen(tok)).toBe(2);
	});

	it('makeCollapsedSelection produces a valid RawSelection', () => {
		const sel = cursorIndex.makeCollapsedSelection(3, 7);
		expect(sel.anchor).toEqual({ line: 3, col: 7 });
		expect(sel.focus).toEqual({ line: 3, col: 7 });
		expect(sel.isCollapsed).toBe(true);
	});

	it('makeSelection with different points is not collapsed', () => {
		const sel = cursorIndex.makeSelection({ line: 0, col: 2 }, { line: 1, col: 5 });
		expect(sel.isCollapsed).toBe(false);
	});

	it('pointsEqual returns true for identical points', () => {
		expect(cursorIndex.pointsEqual({ line: 1, col: 3 }, { line: 1, col: 3 })).toBe(true);
	});

	it('rawColToDomOffset and domOffsetToRawCol are inverses (text token)', () => {
		const tok = { type: 'text', raw: 'hello', content: 'hello', start: 0, end: 5 };
		const { domOffset } = cursorIndex.rawColToDomOffset(tok, 3);
		expect(cursorIndex.domOffsetToRawCol(tok, domOffset)).toBe(3);
	});

	it('findTokenAtRawCol works', () => {
		const tokens = [
			{ type: 'text', raw: 'Hello', content: 'Hello', start: 0, end: 5 },
			{ type: 'bold', raw: '**world**', content: 'world', start: 5, end: 14 },
		];
		expect(cursorIndex.findTokenAtRawCol(tokens, 7)?.type).toBe('bold');
	});

	it('findTokenByStart works', () => {
		const tokens = [{ type: 'text', raw: 'abc', content: 'abc', start: 0, end: 3 }];
		expect(cursorIndex.findTokenByStart(tokens, 0)?.type).toBe('text');
		expect(cursorIndex.findTokenByStart(tokens, 1)).toBeNull();
	});

	it('clampPoint works', () => {
		const blocks = [{ raw: 'hello', type: 'paragraph', meta: {}, lineIndex: 0 }];
		expect(cursorIndex.clampPoint({ line: 0, col: 99 }, blocks)).toEqual({ line: 0, col: 5 });
	});

	it('captureSelection is a function', () => {
		expect(typeof cursorIndex.captureSelection).toBe('function');
	});

	it('restoreSelection is a function', () => {
		expect(typeof cursorIndex.restoreSelection).toBe('function');
	});

	it('resolvePointToRange is a function', () => {
		expect(typeof cursorIndex.resolvePointToRange).toBe('function');
	});
});

// ---------------------------------------------------------------------------
// Integration: index exports work together in a DOM scenario
// ---------------------------------------------------------------------------

describe('cursor/index — end-to-end DOM integration', () => {
	const { LINE_ATTR, TOKEN_ATTR, captureSelection, restoreSelection, makeCollapsedSelection } =
		cursorIndex;

	/**
	 * Build a minimal editor DOM inline (no helpers import needed here).
	 */
	function buildEditor() {
		const editor = document.createElement('div');

		// Line 0: "Hello **world**"
		const line0 = document.createElement('div');
		line0.setAttribute(LINE_ATTR, '0');

		const textToken = document.createElement('span');
		textToken.setAttribute(TOKEN_ATTR, '0');
		const textNode0 = document.createTextNode('Hello ');
		textToken.appendChild(textNode0);

		const boldToken = document.createElement('strong');
		boldToken.setAttribute(TOKEN_ATTR, '6');
		const textNode1 = document.createTextNode('world');
		boldToken.appendChild(textNode1);

		line0.appendChild(textToken);
		line0.appendChild(boldToken);
		editor.appendChild(line0);

		document.body.appendChild(editor);

		return {
			editor,
			textNode0,
			textNode1,
			cleanup: () => document.body.removeChild(editor),
		};
	}

	const tokens = [
		{ type: 'text', raw: 'Hello ', content: 'Hello ', start: 0, end: 6 },
		{ type: 'bold', raw: '**world**', content: 'world', start: 6, end: 15 },
	];

	it('capture then restore round-trips correctly', () => {
		const { editor, textNode1, cleanup } = buildEditor();

		try {
			// Place cursor at DOM offset 2 in the bold text node
			const range = document.createRange();
			range.setStart(textNode1, 2);
			range.collapse(true);
			window.getSelection()?.removeAllRanges();
			window.getSelection()?.addRange(range);

			// Capture
			const rawSel = /** @type {RawSelection} */ (captureSelection(editor, [tokens]));
			// bold prefixLen=2, so rawCol = 6+2+2 = 10
			expect(rawSel.anchor).toEqual({ line: 0, col: 10 });

			// Disturb
			window.getSelection()?.removeAllRanges();

			// Restore
			restoreSelection(editor, rawSel, [tokens]);

			const sel = window.getSelection();
			expect(sel?.anchorNode).toBe(textNode1);
			expect(sel?.anchorOffset).toBe(2);
		} finally {
			window.getSelection()?.removeAllRanges();
			cleanup();
		}
	});

	it('restoreSelection without prior captureSelection places cursor correctly', () => {
		const { editor, textNode0, cleanup } = buildEditor();
		try {
			restoreSelection(editor, makeCollapsedSelection(0, 3), [tokens]);
			const sel = window.getSelection();
			// col=3 is in the text token (prefixLen=0, contentStart=0), domOffset=3
			expect(sel?.anchorNode).toBe(textNode0);
			expect(sel?.anchorOffset).toBe(3);
		} finally {
			window.getSelection()?.removeAllRanges();
			cleanup();
		}
	});
});
