import { describe, it, expect } from 'vitest';
import {
	getTokenPrefixLen,
	rawColToDomOffset,
	domOffsetToRawCol,
	findTokenAtRawCol,
	findTokenByStart,
	makeCollapsedSelection,
	makeSelection,
	pointsEqual,
	clampPoint,
} from './map';
import { tok } from '$lib/test-helpers';

// ---------------------------------------------------------------------------
// getTokenPrefixLen
// ---------------------------------------------------------------------------

describe('getTokenPrefixLen', () => {
	it('text → 0 (no syntax chars)', () => {
		expect(getTokenPrefixLen(tok('text', 'hello', 'hello', 0))).toBe(0);
	});

	it('escape \\* → 1 (backslash not rendered)', () => {
		expect(getTokenPrefixLen(tok('escape', '\\*', '*', 0))).toBe(1);
	});

	it('link [label](url) → 1 (the `[`)', () => {
		expect(getTokenPrefixLen(tok('link', '[label](url)', 'label', 0))).toBe(1);
	});

	it('image ![alt](url) → 2 (the `![`)', () => {
		expect(getTokenPrefixLen(tok('image', '![alt](url)', 'alt', 0))).toBe(2);
	});

	it('italic *hi* → 1', () => {
		expect(getTokenPrefixLen(tok('italic', '*hi*', 'hi', 0))).toBe(1);
	});

	it('italic _hi_ → 1', () => {
		expect(getTokenPrefixLen(tok('italic', '_hi_', 'hi', 0))).toBe(1);
	});

	it('bold **hi** → 2', () => {
		expect(getTokenPrefixLen(tok('bold', '**hi**', 'hi', 0))).toBe(2);
	});

	it('bold __hi__ → 2', () => {
		expect(getTokenPrefixLen(tok('bold', '__hi__', 'hi', 0))).toBe(2);
	});

	it('code `hi` → 1', () => {
		expect(getTokenPrefixLen(tok('code', '`hi`', 'hi', 0))).toBe(1);
	});

	it('code ``hi`` → 2', () => {
		expect(getTokenPrefixLen(tok('code', '``hi``', 'hi', 0))).toBe(2);
	});

	it('code with CommonMark space-strip: ` hi ` → 2 (one space each side stripped)', () => {
		// raw='` hi `' (6), content='hi' (2) → (6-2)/2 = 2
		expect(getTokenPrefixLen(tok('code', '` hi `', 'hi', 0))).toBe(2);
	});

	it('strike ~~hi~~ → 2', () => {
		expect(getTokenPrefixLen(tok('strike', '~~hi~~', 'hi', 0))).toBe(2);
	});

	it('strike ~hi~ (1-char delimiter) → 1', () => {
		expect(getTokenPrefixLen(tok('strike', '~hi~', 'hi', 0))).toBe(1);
	});

	it('custom symmetric ==hi== → 2', () => {
		expect(getTokenPrefixLen(tok('highlight', '==hi==', 'hi', 0))).toBe(2);
	});

	it('custom asymmetric @alice → 0 (non-integer half → fallback)', () => {
		// raw='@alice' (6), content='alice' (5) → (6-5)/2 = 0.5 → fallback 0
		expect(getTokenPrefixLen(tok('mention', '@alice', 'alice', 0))).toBe(0);
	});

	it('custom with raw.length === content.length (same as text) → 0', () => {
		expect(getTokenPrefixLen(tok('custom', 'abc', 'abc', 0))).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// rawColToDomOffset
// ---------------------------------------------------------------------------

describe('rawColToDomOffset', () => {
	describe('text token (no prefix)', () => {
		const t = tok('text', 'hello world', 'hello world', 5);
		// contentStart = 5, contentEnd = 16

		it('col exactly at token.start → within, domOffset 0', () => {
			expect(rawColToDomOffset(t, 5)).toEqual({ domOffset: 0, clamp: 'within' });
		});

		it('col before token.start → before, domOffset 0', () => {
			expect(rawColToDomOffset(t, 4)).toEqual({ domOffset: 0, clamp: 'before' });
		});

		it('col mid-content → within, correct offset', () => {
			expect(rawColToDomOffset(t, 8)).toEqual({ domOffset: 3, clamp: 'within' });
		});

		it('col at contentEnd → after, domOffset = content.length', () => {
			expect(rawColToDomOffset(t, 16)).toEqual({ domOffset: 11, clamp: 'after' });
		});

		it('col past contentEnd → after, domOffset = content.length', () => {
			expect(rawColToDomOffset(t, 99)).toEqual({ domOffset: 11, clamp: 'after' });
		});
	});

	describe('bold token **world** at start=6', () => {
		const t = tok('bold', '**world**', 'world', 6);
		// prefixLen=2, contentStart=8, contentEnd=13

		it('col at first * → before', () => {
			expect(rawColToDomOffset(t, 6)).toEqual({ domOffset: 0, clamp: 'before' });
		});

		it('col at second * → before', () => {
			expect(rawColToDomOffset(t, 7)).toEqual({ domOffset: 0, clamp: 'before' });
		});

		it('col at first content char (w) → within, domOffset 0', () => {
			expect(rawColToDomOffset(t, 8)).toEqual({ domOffset: 0, clamp: 'within' });
		});

		it('col mid-content → within', () => {
			expect(rawColToDomOffset(t, 10)).toEqual({ domOffset: 2, clamp: 'within' });
		});

		it('col at last content char (d) → within', () => {
			expect(rawColToDomOffset(t, 12)).toEqual({ domOffset: 4, clamp: 'within' });
		});

		it('col at closing * → after', () => {
			expect(rawColToDomOffset(t, 13)).toEqual({ domOffset: 5, clamp: 'after' });
		});

		it('col at second closing * → after', () => {
			expect(rawColToDomOffset(t, 14)).toEqual({ domOffset: 5, clamp: 'after' });
		});
	});

	describe('escape \\* at start=3', () => {
		const t = tok('escape', '\\*', '*', 3);
		// prefixLen=1, contentStart=4, contentEnd=5

		it('col at backslash → before', () => {
			expect(rawColToDomOffset(t, 3)).toEqual({ domOffset: 0, clamp: 'before' });
		});

		it('col at * (first content char) → within, domOffset 0', () => {
			expect(rawColToDomOffset(t, 4)).toEqual({ domOffset: 0, clamp: 'within' });
		});

		it('col past end → after', () => {
			expect(rawColToDomOffset(t, 5)).toEqual({ domOffset: 1, clamp: 'after' });
		});
	});

	describe('link [hello](url) at start=0', () => {
		const t = tok('link', '[hello](url)', 'hello', 0);
		// prefixLen=1, contentStart=1, contentEnd=6

		it('col at [ → before', () => {
			expect(rawColToDomOffset(t, 0)).toEqual({ domOffset: 0, clamp: 'before' });
		});

		it('col at h (first content char) → within, domOffset 0', () => {
			expect(rawColToDomOffset(t, 1)).toEqual({ domOffset: 0, clamp: 'within' });
		});

		it('col mid-label → within', () => {
			expect(rawColToDomOffset(t, 3)).toEqual({ domOffset: 2, clamp: 'within' });
		});

		it('col at ] → after', () => {
			expect(rawColToDomOffset(t, 6)).toEqual({ domOffset: 5, clamp: 'after' });
		});
	});

	describe('image ![alt](url) at start=0', () => {
		const t = { ...tok('image', '![alt](url)', 'alt', 0), alt: 'alt', href: 'url' };
		// prefixLen=2, contentStart=2, contentEnd=5

		it('col at ! → before', () => {
			expect(rawColToDomOffset(t, 0)).toEqual({ domOffset: 0, clamp: 'before' });
		});

		it('col at [ → before', () => {
			expect(rawColToDomOffset(t, 1)).toEqual({ domOffset: 0, clamp: 'before' });
		});

		it('col at a (first content char) → within, domOffset 0', () => {
			expect(rawColToDomOffset(t, 2)).toEqual({ domOffset: 0, clamp: 'within' });
		});

		it('col at ] → after', () => {
			expect(rawColToDomOffset(t, 5)).toEqual({ domOffset: 3, clamp: 'after' });
		});
	});
});

// ---------------------------------------------------------------------------
// domOffsetToRawCol
// ---------------------------------------------------------------------------

describe('domOffsetToRawCol', () => {
	it('text token: domOffset 0 → token.start', () => {
		const t = tok('text', 'hello', 'hello', 3);
		expect(domOffsetToRawCol(t, 0)).toBe(3);
	});

	it('text token: domOffset N → token.start + N', () => {
		const t = tok('text', 'hello', 'hello', 3);
		expect(domOffsetToRawCol(t, 4)).toBe(7);
	});

	it('bold token: domOffset 0 → contentStart (token.start + prefixLen)', () => {
		const t = tok('bold', '**world**', 'world', 6);
		expect(domOffsetToRawCol(t, 0)).toBe(8); // 6 + 2
	});

	it('bold token: domOffset 5 → contentStart + 5', () => {
		const t = tok('bold', '**world**', 'world', 6);
		expect(domOffsetToRawCol(t, 5)).toBe(13);
	});

	it('escape: domOffset 0 → contentStart', () => {
		const t = tok('escape', '\\*', '*', 3);
		expect(domOffsetToRawCol(t, 0)).toBe(4); // 3 + 1
	});

	it('escape: domOffset 1 → contentStart + 1', () => {
		const t = tok('escape', '\\*', '*', 3);
		expect(domOffsetToRawCol(t, 1)).toBe(5);
	});

	it('image: domOffset 0 → contentStart', () => {
		const t = { ...tok('image', '![alt](url)', 'alt', 0), alt: 'alt', href: 'url' };
		expect(domOffsetToRawCol(t, 0)).toBe(2);
	});

	it('clamps domOffset below 0 → contentStart', () => {
		const t = tok('bold', '**hi**', 'hi', 0);
		expect(domOffsetToRawCol(t, -1)).toBe(2); // clamped to 0 → contentStart
	});

	it('clamps domOffset above content.length → contentEnd', () => {
		const t = tok('bold', '**hi**', 'hi', 0);
		expect(domOffsetToRawCol(t, 99)).toBe(4); // contentStart + content.length = 2+2
	});
});

// ---------------------------------------------------------------------------
// Round-trip property
// ---------------------------------------------------------------------------

describe('round-trip: domOffsetToRawCol( rawColToDomOffset(token, col) ) === col', () => {
	const tokens = [
		tok('text', 'Hello ', 'Hello ', 0),
		tok('bold', '**world**', 'world', 6),
		tok('italic', '*cool*', 'cool', 15),
		tok('code', '`fn()`', 'fn()', 22),
		tok('escape', '\\*', '*', 36),
		tok('strike', '~~text~~', 'text', 38),
		{ ...tok('link', '[a](b)', 'a', 46), href: 'b' },
		{ ...tok('image', '![x](y)', 'x', 52), alt: 'x', href: 'y' },
	];

	for (const t of tokens) {
		it(`${t.type}: all content-region positions round-trip`, () => {
			const prefixLen = getTokenPrefixLen(t);
			const contentStart = t.start + prefixLen;
			const contentEnd = contentStart + t.content.length;

			for (let col = contentStart; col < contentEnd; col++) {
				const { domOffset } = rawColToDomOffset(t, col);
				const back = domOffsetToRawCol(t, domOffset);
				expect(back).toBe(col);
			}
		});
	}
});

// ---------------------------------------------------------------------------
// findTokenAtRawCol
// ---------------------------------------------------------------------------

describe('findTokenAtRawCol', () => {
	const tokens = [
		tok('text', 'Hello ', 'Hello ', 0), // start=0, end=6
		tok('bold', '**world**', 'world', 6), // start=6, end=15
		tok('text', '!', '!', 15), // start=15, end=16
	];

	it('empty array → null', () => {
		expect(findTokenAtRawCol([], 0)).toBeNull();
	});

	it('col 0 → first token', () => {
		expect(findTokenAtRawCol(tokens, 0)).toBe(tokens[0]);
	});

	it('col within first token', () => {
		expect(findTokenAtRawCol(tokens, 3)).toBe(tokens[0]);
	});

	it('col exactly at start of second token', () => {
		expect(findTokenAtRawCol(tokens, 6)).toBe(tokens[1]);
	});

	it('col within second token (inside ** syntax)', () => {
		expect(findTokenAtRawCol(tokens, 7)).toBe(tokens[1]);
	});

	it('col within second token (content region)', () => {
		expect(findTokenAtRawCol(tokens, 10)).toBe(tokens[1]);
	});

	it('col at last char of second token (end-1)', () => {
		expect(findTokenAtRawCol(tokens, 14)).toBe(tokens[1]);
	});

	it('col exactly at start of third token (= end of second)', () => {
		// rawCol=15: 15 < tokens[1].end=15 is false → 15 < tokens[2].end=16 is true → tokens[2]
		expect(findTokenAtRawCol(tokens, 15)).toBe(tokens[2]);
	});

	it('col at end of last token → falls back to last token', () => {
		// rawCol=16 >= all token ends → falls back to last
		expect(findTokenAtRawCol(tokens, 16)).toBe(tokens[2]);
	});

	it('col far past end → last token', () => {
		expect(findTokenAtRawCol(tokens, 999)).toBe(tokens[2]);
	});

	it('single-token array always returns that token', () => {
		const single = [tok('text', 'hi', 'hi', 0)];
		expect(findTokenAtRawCol(single, 0)).toBe(single[0]);
		expect(findTokenAtRawCol(single, 2)).toBe(single[0]);
		expect(findTokenAtRawCol(single, 99)).toBe(single[0]);
	});
});

// ---------------------------------------------------------------------------
// findTokenByStart
// ---------------------------------------------------------------------------

describe('findTokenByStart', () => {
	const tokens = [
		tok('text', 'Hello ', 'Hello ', 0),
		tok('bold', '**world**', 'world', 6),
		tok('text', '!', '!', 15),
	];

	it('finds token with start=0', () => {
		expect(findTokenByStart(tokens, 0)).toBe(tokens[0]);
	});

	it('finds token with start=6', () => {
		expect(findTokenByStart(tokens, 6)).toBe(tokens[1]);
	});

	it('finds token with start=15', () => {
		expect(findTokenByStart(tokens, 15)).toBe(tokens[2]);
	});

	it('returns null when no token has that start', () => {
		expect(findTokenByStart(tokens, 1)).toBeNull();
		expect(findTokenByStart(tokens, 99)).toBeNull();
	});

	it('returns null for empty array', () => {
		expect(findTokenByStart([], 0)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// makeCollapsedSelection
// ---------------------------------------------------------------------------

describe('makeCollapsedSelection', () => {
	it('anchor and focus are equal', () => {
		const sel = makeCollapsedSelection(2, 7);
		expect(sel.anchor).toEqual({ line: 2, col: 7 });
		expect(sel.focus).toEqual({ line: 2, col: 7 });
	});

	it('isCollapsed is true', () => {
		expect(makeCollapsedSelection(0, 0).isCollapsed).toBe(true);
	});

	it('anchor and focus are not the same object reference', () => {
		const sel = makeCollapsedSelection(1, 3);
		// They should be equal in value but separate objects
		expect(sel.anchor).not.toBe(sel.focus);
		expect(sel.anchor).toEqual(sel.focus);
	});
});

// ---------------------------------------------------------------------------
// makeSelection
// ---------------------------------------------------------------------------

describe('makeSelection', () => {
	it('same points → isCollapsed true', () => {
		const sel = makeSelection({ line: 1, col: 5 }, { line: 1, col: 5 });
		expect(sel.isCollapsed).toBe(true);
	});

	it('different col on same line → isCollapsed false', () => {
		const sel = makeSelection({ line: 0, col: 3 }, { line: 0, col: 7 });
		expect(sel.isCollapsed).toBe(false);
	});

	it('different lines → isCollapsed false', () => {
		const sel = makeSelection({ line: 0, col: 5 }, { line: 2, col: 5 });
		expect(sel.isCollapsed).toBe(false);
	});

	it('anchor and focus are preserved exactly', () => {
		const anchor = { line: 1, col: 3 };
		const focus = { line: 2, col: 7 };
		const sel = makeSelection(anchor, focus);
		expect(sel.anchor).toBe(anchor);
		expect(sel.focus).toBe(focus);
	});
});

// ---------------------------------------------------------------------------
// pointsEqual
// ---------------------------------------------------------------------------

describe('pointsEqual', () => {
	it('same line, same col → true', () => {
		expect(pointsEqual({ line: 1, col: 3 }, { line: 1, col: 3 })).toBe(true);
	});

	it('same line, different col → false', () => {
		expect(pointsEqual({ line: 1, col: 3 }, { line: 1, col: 4 })).toBe(false);
	});

	it('different line, same col → false', () => {
		expect(pointsEqual({ line: 1, col: 3 }, { line: 2, col: 3 })).toBe(false);
	});

	it('both line=0, col=0 → true', () => {
		expect(pointsEqual({ line: 0, col: 0 }, { line: 0, col: 0 })).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// clampPoint
// ---------------------------------------------------------------------------

describe('clampPoint', () => {
	const blocks = [
		{ raw: 'Hello world', type: 'paragraph', meta: {}, lineIndex: 0 },
		{ raw: '## Heading', type: 'heading', meta: { level: 2 }, lineIndex: 1 },
		{ raw: '', type: 'blank', meta: {}, lineIndex: 2 },
	];

	it('col within [0, raw.length] is unchanged', () => {
		expect(clampPoint({ line: 0, col: 5 }, blocks)).toEqual({ line: 0, col: 5 });
	});

	it('col 0 is unchanged', () => {
		expect(clampPoint({ line: 0, col: 0 }, blocks)).toEqual({ line: 0, col: 0 });
	});

	it('col === raw.length is unchanged (valid end-of-line position)', () => {
		expect(clampPoint({ line: 0, col: 11 }, blocks)).toEqual({ line: 0, col: 11 });
	});

	it('col > raw.length → clamped to raw.length', () => {
		expect(clampPoint({ line: 0, col: 99 }, blocks)).toEqual({ line: 0, col: 11 });
	});

	it('col < 0 → clamped to 0', () => {
		expect(clampPoint({ line: 0, col: -5 }, blocks)).toEqual({ line: 0, col: 0 });
	});

	it('blank line: col > 0 → clamped to 0', () => {
		expect(clampPoint({ line: 2, col: 5 }, blocks)).toEqual({ line: 2, col: 0 });
	});

	it('unknown lineIndex → point returned unchanged', () => {
		const point = { line: 99, col: 5 };
		expect(clampPoint(point, blocks)).toBe(point);
	});

	it('does not mutate the input point', () => {
		const point = { line: 0, col: 99 };
		const result = clampPoint(point, blocks);
		expect(point.col).toBe(99); // original unchanged
		expect(result.col).toBe(11); // new object
		expect(result).not.toBe(point);
	});
});
