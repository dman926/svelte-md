/**
 * DOM → RawSelection capture.
 *
 * Reads the browser's current Selection and translates both endpoints (anchor
 * and focus) into `RawPoint` values in raw markdown space.
 *
 * ## DOM contract
 *
 * The cursor module expects the rendering layer to place two data attributes:
 *
 * - `data-md-line="N"` on the container element for each block line
 *   (N = `block.lineIndex`).
 * - `data-md-token="N"` on the wrapper element for each inline token
 *   (N = `token.start`, the raw byte offset).
 *
 * Lines with no inline tokens (opaque blocks: code_fence_body, hr, etc.) have
 * no `data-md-token` elements. Their cursor position maps directly: DOM offset
 * = raw col (1:1 since the rendered text equals the raw text for these lines).
 *
 * ## Edge cases
 *
 * - **Blank lines**: The selection node may be the line element itself or a
 *   `<br>` child. Both map to `{ line, col: 0 }`.
 * - **Element nodes**: When `anchorNode` is an element (not a text node),
 *   `anchorOffset` is a child index. We resolve to the child and recurse.
 * - **Outside the editor**: Returns `null` if either endpoint is not within
 *   `editorEl`.
 * - **Collapsed selection**: `anchor` and `focus` will be equal; `isCollapsed`
 *   is `true`.
 */

/**
 * @typedef {import('./types.js').RawPoint}     RawPoint
 * @typedef {import('./types.js').RawSelection} RawSelection
 * @typedef {import('../parser/types.js').InlineToken} InlineToken
 */

import { LINE_ATTR, TOKEN_ATTR } from './types.js';
import { domOffsetToRawCol, findTokenByStart, makeSelection } from './map.js';

// ---------------------------------------------------------------------------
// Internal DOM helpers
// ---------------------------------------------------------------------------

/**
 * Walk up from `node`, staying within `boundary`, to find the nearest ancestor
 * (or self) that carries `data-md-line` and the nearest that carries
 * `data-md-token`.
 *
 * Stops at `boundary` (exclusive — will not inspect the boundary element
 * itself for these attributes, since it is the editor root).
 *
 * @param {Node}    node
 * @param {Element} boundary - The editor root element.
 * @returns {{ lineEl: Element | null, tokenEl: Element | null }}
 */
function walkUpForAttributes(node, boundary) {
	/** @type {Element | null} */
	let tokenEl = null;
	/** @type {Element | null} */
	let lineEl = null;

	/** @type {Element | null} */
	let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : /** @type {Element} */ (node);

	while (el && el !== boundary) {
		if (!tokenEl && el.hasAttribute(TOKEN_ATTR)) tokenEl = el;
		if (!lineEl && el.hasAttribute(LINE_ATTR)) lineEl = el;
		if (tokenEl && lineEl) break;
		el = el.parentElement;
	}

	return { lineEl, tokenEl };
}

/**
 * Check whether `node` is a descendant of (or equal to) `ancestor`.
 *
 * @param {Node}    node
 * @param {Element} ancestor
 * @returns {boolean}
 */
function isWithin(node, ancestor) {
	return ancestor.contains(node);
}

// ---------------------------------------------------------------------------
// Single-endpoint capture
// ---------------------------------------------------------------------------

/**
 * Translate a single Selection endpoint (a DOM node + character/child offset)
 * into a `RawPoint`.
 *
 * @param {Node}          node          - `selection.anchorNode` or `.focusNode`
 * @param {number}        offset        - `selection.anchorOffset` or `.focusOffset`
 * @param {Element}       editorEl      - The root contenteditable element.
 * @param {(InlineToken[] | null | undefined)[]} tokensByLine
 *   Sparse array indexed by `lineIndex`. `null`/`undefined`/empty entries
 *   indicate opaque blocks (direct offset mapping).
 * @returns {RawPoint | null} `null` if the endpoint cannot be resolved.
 */
function capturePoint(node, offset, editorEl, tokensByLine) {
	// -------------------------------------------------------------------------
	// Guard: endpoint must be within the editor
	// -------------------------------------------------------------------------
	if (!isWithin(node, editorEl)) return null;

	// -------------------------------------------------------------------------
	// Element node: `offset` is a child index, not a character offset.
	// This happens for blank lines (<br>), collapsed selections in empty
	// containers, or when the browser places the caret between block elements.
	// -------------------------------------------------------------------------
	if (node.nodeType === Node.ELEMENT_NODE) {
		const el = /** @type {Element} */ (node);

		// Case 1: The element itself is a line container (e.g. editor has a
		// single line and the selection is the editor root).
		if (el.hasAttribute(LINE_ATTR)) {
			const lineIndex = parseInt(el.getAttribute(LINE_ATTR) ?? '0', 10);
			return { line: lineIndex, col: 0 };
		}

		// Case 2: Resolve via child at `offset`.
		const child = el.childNodes[offset] ?? el.childNodes[el.childNodes.length - 1];

		if (!child) {
			// Empty element — walk up to find the line.
			const { lineEl } = walkUpForAttributes(el, editorEl);
			if (!lineEl) return null;
			return { line: parseInt(lineEl.getAttribute(LINE_ATTR) ?? '0', 10), col: 0 };
		}

		// If the child is a <br> (blank line placeholder), col = 0.
		if (child.nodeName === 'BR') {
			const { lineEl } = walkUpForAttributes(child, editorEl);
			if (!lineEl) return null;
			return { line: parseInt(lineEl.getAttribute(LINE_ATTR) ?? '0', 10), col: 0 };
		}

		// If the child is a text node, recurse with character offset 0.
		if (child.nodeType === Node.TEXT_NODE) {
			return capturePoint(child, 0, editorEl, tokensByLine);
		}

		// If the child is an element (e.g. a token wrapper), recurse into it.
		if (child.nodeType === Node.ELEMENT_NODE) {
			return capturePoint(child, 0, editorEl, tokensByLine);
		}

		return null;
	}

	// -------------------------------------------------------------------------
	// Text node: `offset` is the character offset within the text content.
	// This is the normal case for most cursor positions.
	// -------------------------------------------------------------------------
	if (node.nodeType === Node.TEXT_NODE) {
		const { lineEl, tokenEl } = walkUpForAttributes(node, editorEl);

		if (!lineEl) return null;
		const lineIndex = parseInt(lineEl.getAttribute(LINE_ATTR) ?? '0', 10);

		// ---
		// Opaque block or line with no token wrappers: DOM offset = raw col.
		// ---
		if (!tokenEl) {
			return { line: lineIndex, col: offset };
		}

		// ---
		// Inline token: look up the token object and apply prefix-length math.
		// ---
		const tokenStart = parseInt(tokenEl.getAttribute(TOKEN_ATTR) ?? '0', 10);
		const tokens = tokensByLine[lineIndex];

		if (!tokens || tokens.length === 0) {
			// tokensByLine says this line is opaque — use direct offset.
			return { line: lineIndex, col: tokenStart + offset };
		}

		const token = findTokenByStart(tokens, tokenStart);

		if (!token) {
			// Shouldn't happen if DOM and token arrays are in sync, but be safe.
			return { line: lineIndex, col: tokenStart + offset };
		}

		return { line: lineIndex, col: domOffsetToRawCol(token, offset) };
	}

	return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the browser's current `Selection` and translate both endpoints into a
 * `RawSelection` in raw markdown space.
 *
 * Returns `null` when:
 * - There is no active selection (`getSelection()` returns `null` or has
 *   `rangeCount === 0`).
 * - Either endpoint is outside `editorEl`.
 * - Either endpoint cannot be resolved to a valid line/col.
 *
 * ```js
 * import { captureSelection } from './capture.js';
 *
 * // Inside a beforeinput or input handler:
 * const sel = captureSelection(editorEl, tokensByLine);
 * if (sel) {
 *   savedCursor = sel; // save before DOM mutation
 * }
 * ```
 *
 * @param {Element} editorEl
 *   The root `contenteditable` element that contains all line containers.
 * @param {(InlineToken[] | null | undefined)[]} tokensByLine
 *   Indexed by `block.lineIndex`. Entries are the inline token arrays produced
 *   by `parser.tokenizeBlock(block)`. `null`, `undefined`, or empty arrays
 *   indicate opaque blocks (code fences, HR, blank) where raw col = DOM offset.
 * @returns {RawSelection | null}
 */
export function captureSelection(editorEl, tokensByLine) {
	const domSel = window.getSelection();
	if (!(domSel && domSel.anchorNode && domSel.focusNode) || domSel.rangeCount == 0) return null;

	const anchor = capturePoint(domSel.anchorNode, domSel.anchorOffset, editorEl, tokensByLine);
	if (!anchor) return null;

	// For collapsed selections skip the redundant focus lookup.
	if (domSel.isCollapsed) {
		return makeSelection(anchor, { ...anchor });
	}

	const focus = capturePoint(domSel.focusNode, domSel.focusOffset, editorEl, tokensByLine);
	if (!focus) return null;

	return makeSelection(anchor, focus);
}
