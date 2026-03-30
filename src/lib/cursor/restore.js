/**
 * RawSelection → DOM restore.
 *
 * Translates a `RawSelection` (positions in raw markdown space) back into
 * a DOM `Selection` by locating the correct text nodes and character offsets.
 *
 * Called after every DOM patch (re-render) to put the cursor back in the
 * right place. Must be called synchronously after the DOM mutation to avoid
 * a frame where the cursor appears lost.
 *
 * ## How it works
 *
 * For each endpoint `{ line, col }`:
 * 1. Find the line container element via `[data-md-line="N"]`.
 * 2. Look up `tokensByLine[N]`.
 * 3. If the line has tokens:
 *    a. Find the token that owns `col` (via `findTokenAtRawCol`).
 *    b. Map `col` to a DOM offset within that token's text node.
 *    c. Find the token's wrapper element via `[data-md-token="M"]`.
 *    d. Walk down to its first text node.
 * 4. If the line has no tokens (opaque block, blank line):
 *    a. Walk down to the first text node of the line element.
 *    b. Use `col` directly as the character offset.
 *    c. For blank lines (`<br>`), place the cursor at the line element itself.
 * 5. Build a `Range` from the two endpoints and apply it to the `Selection`.
 *
 * ## Edge cases
 *
 * - **Blank lines**: The line element has a `<br>` child and no text nodes.
 *   We set the range on the line element itself at offset 0.
 * - **Out-of-range col**: Clamped to `[0, textNode.length]` so stale cursors
 *   don't throw.
 * - **Missing elements**: If a line or token element is not found (e.g. during
 *   a partial re-render), the restore is a no-op.
 * - **Opaque blocks**: Code fence bodies, HRs, and similar blocks have their
 *   raw content rendered directly with no token wrappers. `col` maps 1:1 to
 *   the DOM text offset.
 */

/**
 * @typedef {import('./types.js').RawPoint}     RawPoint
 * @typedef {import('./types.js').RawSelection} RawSelection
 * @typedef {import('../parser/types.js').InlineToken} InlineToken
 */

import { LINE_ATTR, TOKEN_ATTR } from './types.js';
import { rawColToDomOffset, findTokenAtRawCol } from './map.js';

// ---------------------------------------------------------------------------
// Internal DOM helpers
// ---------------------------------------------------------------------------

/**
 * Find the line container element for a given `lineIndex` within `editorEl`.
 *
 * @param {Element} editorEl
 * @param {number}  lineIndex
 * @returns {Element | null}
 */
function findLineElement(editorEl, lineIndex) {
	return editorEl.querySelector(`[${LINE_ATTR}="${lineIndex}"]`);
}

/**
 * Find the token wrapper element for a given `tokenStart` within `lineEl`.
 *
 * @param {Element} lineEl
 * @param {number}  tokenStart - The `token.start` value used as the attribute value.
 * @returns {Element | null}
 */
function findTokenElement(lineEl, tokenStart) {
	return lineEl.querySelector(`[${TOKEN_ATTR}="${tokenStart}"]`);
}

/**
 * Walk `el`'s subtree (depth-first) and return the first `Text` node found.
 * Returns `null` if the subtree contains no text nodes.
 *
 * @param {Element} el
 * @returns {Text | null}
 */
function firstTextNode(el) {
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	return /** @type {Text | null} */ (walker.nextNode());
}

/**
 * Resolve a single raw-space point to a `{ node, offset }` pair ready for
 * use in a `Range`.
 *
 * Returns `null` if the DOM node cannot be found (e.g. line not yet rendered).
 *
 * @param {RawPoint}  point
 * @param {Element}   editorEl
 * @param {(InlineToken[] | null | undefined)[]} tokensByLine
 * @returns {{ node: Node, offset: number } | null}
 */
function resolvePoint(point, editorEl, tokensByLine) {
	const lineEl = findLineElement(editorEl, point.line);
	if (!lineEl) return null;

	const tokens = tokensByLine[point.line];
	const hasTokens = Array.isArray(tokens) && tokens.length > 0;

	// -------------------------------------------------------------------------
	// Opaque / blank line — no token wrappers
	// -------------------------------------------------------------------------
	if (!hasTokens) {
		// Try to find a direct text node (opaque blocks like code_fence_body
		// render their raw content as a single text node).
		const textNode = firstTextNode(lineEl);

		if (textNode) {
			const clamped = Math.max(0, Math.min(point.col, textNode.length));
			return { node: textNode, offset: clamped };
		}

		// No text node found — the line is truly empty (blank line with <br>).
		// Place the caret at the line element itself, child offset 0.
		return { node: lineEl, offset: 0 };
	}

	// -------------------------------------------------------------------------
	// Tokenised line — map rawCol → token → DOM offset
	// -------------------------------------------------------------------------
	const token = findTokenAtRawCol(tokens, point.col);
	if (!token) return null;

	const { domOffset } = rawColToDomOffset(token, point.col);

	// Find the token's wrapper element, then walk to its text node.
	const tokenEl = findTokenElement(lineEl, token.start);
	if (!tokenEl) return null;

	const textNode = firstTextNode(tokenEl);
	if (textNode) {
		const clamped = Math.max(0, Math.min(domOffset, textNode.length));
		return { node: textNode, offset: clamped };
	}

	// Token wrapper has no text node (e.g. empty bold `****`). Fall back to
	// placing the caret at the wrapper element itself.
	return { node: tokenEl, offset: 0 };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Translate a raw-space `RawPoint` into a DOM `Range` and return it.
 *
 * Unlike `restoreSelection`, this function does not apply the range to the
 * browser's `Selection` — it just builds and returns the `Range` object.
 * Useful for building multi-endpoint selections or for Playwright / testing.
 *
 * Returns `null` if the point cannot be resolved to a DOM position.
 *
 * @param {Element}  editorEl
 * @param {RawPoint} point
 * @param {(InlineToken[] | null | undefined)[]} tokensByLine
 * @returns {Range | null}
 */
export function resolvePointToRange(editorEl, point, tokensByLine) {
	const resolved = resolvePoint(point, editorEl, tokensByLine);
	if (!resolved) return null;
	const range = document.createRange();
	range.setStart(resolved.node, resolved.offset);
	range.collapse(true);
	return range;
}

/**
 * Restore the browser `Selection` from a `RawSelection`.
 *
 * Translates both the anchor and focus endpoints from raw markdown space into
 * DOM positions, then applies them to `window.getSelection()`.
 *
 * Call this immediately after any DOM patch (re-render) that may have
 * invalidated the browser's selection. Because DOM mutations reset the
 * selection, this is the only reliable way to preserve cursor position through
 * a re-render cycle.
 *
 * ```js
 * import { restoreSelection } from './restore.js';
 *
 * // After DOM patch:
 * if (savedCursor) {
 *   restoreSelection(editorEl, savedCursor, tokensByLine);
 * }
 * ```
 *
 * @param {Element}      editorEl
 * @param {RawSelection} rawSel
 * @param {(InlineToken[] | null | undefined)[]} tokensByLine
 *   Indexed by `block.lineIndex`. Must reflect the **post-patch** token state
 *   (i.e., the same `tokensByLine` used to render the updated DOM).
 * @returns {void}
 */
export function restoreSelection(editorEl, rawSel, tokensByLine) {
	const domSel = window.getSelection();
	if (!domSel) return;

	const anchorResolved = resolvePoint(rawSel.anchor, editorEl, tokensByLine);
	if (!anchorResolved) return;

	// For a collapsed selection, use a single collapsed range.
	if (rawSel.isCollapsed) {
		const range = document.createRange();
		range.setStart(anchorResolved.node, anchorResolved.offset);
		range.collapse(true);
		domSel.removeAllRanges();
		domSel.addRange(range);
		return;
	}

	// For a range selection, resolve the focus endpoint separately.
	const focusResolved = resolvePoint(rawSel.focus, editorEl, tokensByLine);
	if (!focusResolved) {
		// If focus can't be resolved, fall back to a collapsed selection at anchor.
		const range = document.createRange();
		range.setStart(anchorResolved.node, anchorResolved.offset);
		range.collapse(true);
		domSel.removeAllRanges();
		domSel.addRange(range);
		return;
	}

	// Build a range from anchor to focus.
	// The browser's Selection API differentiates anchor (start of drag) from
	// focus (end of drag), but Range always goes from earlier to later in the
	// document. We reconstruct the directional selection using
	// `selection.extend()` when available.
	try {
		const range = document.createRange();
		range.setStart(anchorResolved.node, anchorResolved.offset);
		range.setEnd(focusResolved.node, focusResolved.offset);

		if (range.collapsed && !rawSel.isCollapsed) {
			// The points are in reverse document order (RTL selection / reverse drag).
			// Swap start and end, then use extend() to restore directionality.
			range.setStart(focusResolved.node, focusResolved.offset);
			range.setEnd(anchorResolved.node, anchorResolved.offset);
			domSel.removeAllRanges();
			domSel.addRange(range);
			// extend() re-applies the focus point without changing the anchor, restoring
			// the original selection direction. Not all environments support extend()
			// (e.g. IE), so guard appropriately.
			if (typeof domSel.extend === 'function') {
				domSel.extend(focusResolved.node, focusResolved.offset);
			}
		} else {
			domSel.removeAllRanges();
			domSel.addRange(range);
		}
	} catch {
		// Range operations can throw if the DOM is in a transitional state.
		// Silently swallow — the cursor will be placed on the next render cycle.
	}
}
