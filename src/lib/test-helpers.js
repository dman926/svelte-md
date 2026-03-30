/**
 * Shared helpers for tests
 */

import { LINE_ATTR, TOKEN_ATTR } from './cursor/types.js';

/** Attribute the patcher uses for diffing and CSS hooks. */
export const TYPE_ATTR = 'data-md-type';

/** @import { Block, InlineToken } from './parser/types'; */

/**
 * Build a minimal InlineToken object.
 * `end` is always derived from `start + raw.length`.
 *
 * @param {string} type
 * @param {string} raw
 * @param {string} content
 * @param {number} start
 * @param {Record<string,unknown>} [extra]
 * @returns {InlineToken}
 */
export function tok(type, raw, content, start, extra = {}) {
	return { type, raw, content, start, end: start + raw.length, ...extra };
}

/**
 * Build a minimal Block object.
 *
 * @param {string} type
 * @param {string} raw
 * @param {number} lineIndex
 * @param {Record<string,unknown>} [meta]
 * @returns {Block}
 */
export const blk = (type, raw, lineIndex, meta = {}) => ({ type, raw, lineIndex, meta });

/**
 * Assert the raw-offset invariant for every token in the array:
 *   `raw.slice(token.start, token.end) === token.raw`
 *
 * Returns `true` if all pass, throws with a descriptive message otherwise.
 *
 * @param {string} lineRaw - The full raw line string.
 * @param {InlineToken[]} tokens
 */
export function assertInvariant(lineRaw, tokens) {
	for (const t of tokens) {
		const slice = lineRaw.slice(t.start, t.end);
		if (slice !== t.raw) {
			throw new Error(
				`Invariant broken on ${t.type} token:\n` +
					`  raw.slice(${t.start}, ${t.end}) = ${JSON.stringify(slice)}\n` +
					`  token.raw                        = ${JSON.stringify(t.raw)}`,
			);
		}
	}
	return true;
}

/**
 * Assert that a tokenized line has no gaps or overlaps between adjacent tokens,
 * and that the first token starts at `contentStart` and the last ends at
 * `raw.length`.
 *
 * @param {string} lineRaw
 * @param {InlineToken[]} tokens
 * @param {number} [contentStart=0]
 */
export function assertCoverage(lineRaw, tokens, contentStart = 0) {
	if (tokens.length === 0) return;

	if (tokens[0].start !== contentStart) {
		throw new Error(`First token starts at ${tokens[0].start}, expected ${contentStart}`);
	}

	for (let i = 0; i < tokens.length - 1; i++) {
		if (tokens[i].end !== tokens[i + 1].start) {
			throw new Error(
				`Gap or overlap between tokens[${i}] (end=${tokens[i].end}) ` +
					`and tokens[${i + 1}] (start=${tokens[i + 1].start})`,
			);
		}
	}

	const last = tokens[tokens.length - 1];
	if (last.end !== lineRaw.length) {
		throw new Error(`Last token ends at ${last.end}, expected ${lineRaw.length}`);
	}
}

// ---------------------------------------------------------------------------
// DOM builder types (JSDoc only — no TS in this file)
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   lineIndex: number,
 *   blank?:    boolean,
 *   opaque?:   string,
 *   tokens?:   Array<{ tokenStart: number, tokenType:  string, content: string, tag?: string }>,
 * }} LineSpec
 */

// ---------------------------------------------------------------------------
// DOM builder
// ---------------------------------------------------------------------------

/**
 * Build an editor root element containing one `[data-md-line]` child per spec.
 *
 * Each spec can describe one of three line layouts:
 *
 * 1. **blank** (`{ lineIndex, blank: true }`)
 *    → `<div data-md-line="N"><br></div>`
 *
 * 2. **opaque** (`{ lineIndex, opaque: 'raw text' }`)
 *    → `<div data-md-line="N"><span>raw text</span></div>`
 *    No `data-md-token` is present; capture maps DOM offset → raw col directly.
 *
 * 3. **tokenized** (`{ lineIndex, tokens: [{ tokenStart, content, tag? }] }`)
 *    → `<div data-md-line="N"><span data-md-token="M">content</span>…</div>`
 *
 * Returns both the editor element and a lookup map from lineIndex to the
 * text nodes of each token, for easy selection setup in tests.
 *
 * @param {LineSpec[]} specs
 * @returns {{
 *   editor: HTMLDivElement,
 *   lineEl:     (lineIndex: number) => HTMLElement,
 *   tokenEl:    (lineIndex: number, tokenStart: number) => Element
 *   textNodeOf: (lineIndex: number, tokenStart: number | 'opaque') => Text,
 * }}
 */
export function buildEditorDom(specs) {
	const editor = document.createElement('div');

	/**
	 * @type {Map<string, Text>}
	 * key = `${lineIndex}:${tokenStart}`
	 */
	const textNodes = new Map();

	/** @type {Map<string, Element>} */
  const tokenEls = new Map();

	/** @type {Map<number, HTMLElement>} */
	const lineEls = new Map();

	for (const spec of specs) {
		const lineEl = document.createElement('div');
		lineEl.setAttribute(LINE_ATTR, String(spec.lineIndex));
		lineEls.set(spec.lineIndex, lineEl);

		if (spec.blank) {
			// Blank line: single <br> child, no text node
			lineEl.appendChild(document.createElement('br'));
		} else if (typeof spec.opaque === 'string') {
			// Opaque block: direct text inside a wrapper, no data-md-token
			const wrapper = document.createElement('span');
			const textNode = document.createTextNode(spec.opaque);
			wrapper.appendChild(textNode);
			lineEl.appendChild(wrapper);
			// Key "N:opaque" for opaque text node
			textNodes.set(`${spec.lineIndex}:opaque`, textNode);
		} else if (Array.isArray(spec.tokens)) {
			// Tokenized line: one element per token
			for (const { tokenStart, content, tag = 'span' } of spec.tokens) {
				const tokenEl = document.createElement(tag);
				tokenEl.setAttribute(TOKEN_ATTR, String(tokenStart));
				const textNode = document.createTextNode(content);
				tokenEl.appendChild(textNode);
				lineEl.appendChild(tokenEl);
				tokenEls.set(`${spec.lineIndex}:${tokenStart}`, tokenEl);
				textNodes.set(`${spec.lineIndex}:${tokenStart}`, textNode);
			}
		}

		editor.appendChild(lineEl);
	}

	return {
		editor,
		
		/**
		 * Look up the line container element for a given lineIndex.
		 * @param {number} lineIndex
		 * @returns {HTMLElement}
		*/
		lineEl(lineIndex) {
			const el = lineEls.get(lineIndex);
			if (!el) throw new Error(`No line element for lineIndex ${lineIndex}`);
			return el;
		},

		/**
		 * Look up the token container Element for a given lineIndex and tokenStart.
		 * @param {number} lineIndex 
		 * @param {number} tokenStart 
		 * @returns {Element}
		 */
		tokenEl(lineIndex, tokenStart) {
      const el = tokenEls.get(`${lineIndex}:${tokenStart}`);
      if (!el) throw new Error(`No token element for ${lineIndex}:${tokenStart}`);
      return el;
    },

		/**
		 * Look up the text node for a specific token on a specific line.
		 * Use `tokenStart = 'opaque'` (the string) for opaque line text nodes.
		 *
		 * @param {number} lineIndex
		 * @param {number | 'opaque'} tokenStart
		 * @returns {Text}
		 */
		textNodeOf(lineIndex, tokenStart) {
			const key = `${lineIndex}:${tokenStart}`;
			const node = textNodes.get(key);
			if (!node) throw new Error(`No text node for key "${key}"`);
			return node;
		},
	};
}

/**
 * Get the identity (reference) of an element's first child with a given
 * attribute. Used to verify in-place reuse vs replacement.
 *
 * @param {Element} lineEl
 * @param {string}  attr
 * @param {string}  value
 * @returns {Element | null}
 */
export function findChild(lineEl, attr, value) {
  return lineEl.querySelector(`[${attr}="${value}"]`);
}

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

/**
 * Place a collapsed browser selection at a specific text node + character offset.
 *
 * @param {Text}   textNode
 * @param {number} offset
 */
export function setCollapsedSelection(textNode, offset) {
	const range = document.createRange();
	range.setStart(textNode, offset);
	range.collapse(true);
	const sel = window.getSelection();
	if (!sel) {
		throw new Error('Selection not found when expected');
	}
	sel.removeAllRanges();
	sel.addRange(range);
}

/**
 * Place a forward (LTR) range selection.
 *
 * @param {Text}   anchorNode
 * @param {number} anchorOffset
 * @param {Text}   focusNode
 * @param {number} focusOffset
 */
export function setRangeSelection(anchorNode, anchorOffset, focusNode, focusOffset) {
	const range = document.createRange();
	range.setStart(anchorNode, anchorOffset);
	range.setEnd(focusNode, focusOffset);
	const sel = window.getSelection();
	if (!sel) {
		throw new Error('Selection not found when expected');
	}
	sel.removeAllRanges();
	sel.addRange(range);
}

/**
 * Read the current selection and return a plain object with the key fields,
 * for easy `expect(...).toEqual(...)` comparisons in restore tests.
 *
 * @returns {{
 *   anchorNode: Node | null,
 *   anchorOffset: number,
 *   focusNode: Node | null,
 *   focusOffset: number,
 *   isCollapsed: boolean,
 * }}
 */
export function readSelection() {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) {
		return {
			anchorNode: null,
			anchorOffset: 0,
			focusNode: null,
			focusOffset: 0,
			isCollapsed: true,
		};
	}
	return {
		anchorNode: sel.anchorNode,
		anchorOffset: sel.anchorOffset,
		focusNode: sel.focusNode,
		focusOffset: sel.focusOffset,
		isCollapsed: sel.isCollapsed,
	};
}
