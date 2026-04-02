/**
 * Minimal DOM patcher for inline token rendering.
 *
 * Updates a single line element's children to match a new set of inline
 * tokens, making the smallest possible set of DOM mutations. This preserves
 * DOM node identity where possible, which matters for:
 *
 * - Cursor stability (fewer node replacements = fewer selection disruptions)
 * - IME composition state (replacing a node mid-composition breaks it)
 * - Performance (reusing nodes avoids layout thrash)
 *
 * ## When to use this module
 *
 * This patcher is designed for **framework-agnostic** use — plain JS contexts
 * where you manage the DOM yourself. When using Svelte, the Svelte component
 * layer (with `{#each tokens as t (t.start)}` and `await tick()`) handles
 * patching automatically, and you should use that instead.
 *
 * ## Diffing strategy
 *
 * Tokens are diffed by **position + type**. If `tokens[i]` in the old render
 * has the same type as `tokens[i]` in the new render, the element is reused
 * and only its text content / `data-md-token` attribute is updated. This
 * works well in practice because most keystrokes change the content of one
 * or two tokens without changing their types.
 *
 * When types differ at a position, a new element is created and the old one
 * is discarded.
 *
 * When the token count changes (lines added/removed), the array is rebuilt
 * from the first mismatched position onwards.
 *
 * ## DOM contract
 *
 * Every token element produced by this module carries:
 * - `data-md-token="N"` (N = `token.start`) for the cursor module
 * - `data-md-type="T"` (T = `token.type`) for the patcher's internal diffing
 *   and for CSS styling hooks
 *
 * Opaque blocks (code_fence_*, hr) get a single bare text node.
 * Blank blocks get a `<br>` placeholder.
 */

/** @import { Block, InlineToken } from '../parser/types'; */

import { TOKEN_ATTR } from '../cursor/types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Internal attribute used to track token type on DOM elements. */
const TYPE_ATTR = 'data-md-type';

/** Block types that carry raw verbatim content (no inline tokens). */
const OPAQUE_TYPES = new Set(['code_fence_open', 'code_fence_body', 'code_fence_close', 'hr']);

/**
 * Returns the tag name to use for a given token type.
 *
 * These are the defaults. Pass a custom `createElement` option to `patchLine`
 * to override the element type for any or all token types.
 *
 * @param {string} tokenType
 * @returns {string} Lowercase HTML tag name
 */
function defaultTagFor(tokenType) {
	switch (tokenType) {
		case 'bold':
			return 'strong';
		case 'italic':
			return 'em';
		case 'code':
			return 'code';
		case 'strike':
			return 's';
		default:
			return 'span';
	}
}

/**
 * Determine whether an existing element can be reused for a new token.
 * Reuse is possible when the element's `data-md-type` exactly matches the
 * new token's type.
 *
 * @param {Element}     el
 * @param {InlineToken} token
 * @returns {boolean}
 */
function canReuse(el, token) {
	return el.getAttribute(TYPE_ATTR) === token.type;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a DOM element for a single inline token using the default mapping.
 *
 * Exported so callers can use it as the basis for custom `createElement`
 * functions (e.g. to add extra attributes or wrap in a custom element).
 *
 * The returned element always has:
 * - `data-md-token="N"` — for cursor restore
 * - `data-md-type="T"` — for patcher diffing and CSS hooks
 *
 * @param {InlineToken} token
 * @returns {Element}
 */
export function createTokenElement(token) {
	const tag = defaultTagFor(token.type);
	const el = document.createElement(tag);
	el.setAttribute(TOKEN_ATTR, String(token.start));
	el.setAttribute(TYPE_ATTR, token.type);
	el.textContent = token.content;
	return el;
}

/**
 * Patch a single line element to reflect a new block/token state.
 *
 * Makes the minimal DOM mutations needed to bring `lineEl` in sync with
 * `newBlock` and `newTokens`. The caller is responsible for restoring the
 * browser selection after patching (typically via `restoreSelection` from
 * the cursor module).
 *
 * **Blank lines**: `lineEl` is given a single `<br>` child.
 *
 * **Opaque blocks** (code fence lines, HR): `lineEl` is given a single text
 * node containing `newBlock.raw`. If an existing text node is present, only
 * its content is updated (no node replacement).
 *
 * **Tokenized blocks**: existing token elements are reused where type matches
 * at the same position. Only text content and the `data-md-token` attribute
 * are updated for reused elements. New elements are created for positions
 * where the type changed. `lineEl.replaceChildren` is used once when the
 * child list changes; it is skipped entirely when every child was reused in
 * place.
 *
 * @param {Element}     lineEl    - The `[data-md-line]` container element
 * @param {Block}       newBlock  - The new block state
 * @param {InlineToken[]} newTokens - New inline tokens (empty for opaque/blank)
 * @param {object}      [options]
 * @param {(token: InlineToken) => Element} [options.createElement]
 *   Factory for new token elements. Defaults to `createTokenElement`.
 *   Must set `data-md-token` and `data-md-type` on the returned element.
 */
export function patchLine(lineEl, newBlock, newTokens, options = {}) {
	const { createElement = createTokenElement } = options;

	// ── Blank line ─────────────────────────────────────────────────────────────
	if (newBlock.type === 'blank') {
		const existing = lineEl.firstChild;
		if (
			!(existing instanceof Element && existing.tagName === 'BR') ||
			lineEl.childNodes.length !== 1
		) {
			lineEl.replaceChildren(document.createElement('br'));
		}
		return;
	}

	// ── Opaque block ───────────────────────────────────────────────────────────
	if (OPAQUE_TYPES.has(newBlock.type)) {
		const target = newBlock.raw;
		const firstChild = lineEl.firstChild;

		if (firstChild?.nodeType === Node.TEXT_NODE && lineEl.childNodes.length === 1) {
			// Update existing text node in place (no node replacement)
			if (firstChild.nodeValue !== target) firstChild.nodeValue = target;
		} else {
			lineEl.replaceChildren(document.createTextNode(target));
		}
		return;
	}

	// ── Tokenized block ────────────────────────────────────────────────────────
	// Collect existing token elements (elements with data-md-token)
	const existingEls = /** @type {Element[]} */ (
		[...lineEl.children].filter((c) => c.hasAttribute(TOKEN_ATTR))
	);

	let structureChanged = existingEls.length !== newTokens.length;
	const finalEls = new Array(newTokens.length);

	for (let i = 0; i < newTokens.length; i++) {
		const token = newTokens[i];
		const existing = existingEls[i];

		if (existing && canReuse(existing, token)) {
			// ── Reuse in place ────────────────────────────────────────────────────
			// Update the token start attribute (may have shifted after an edit)
			if (existing.getAttribute(TOKEN_ATTR) !== String(token.start)) {
				existing.setAttribute(TOKEN_ATTR, String(token.start));
			}
			existing.textContent = token.content;
			finalEls[i] = existing;
		} else {
			// ── Replace ───────────────────────────────────────────────────────────
			finalEls[i] = createElement(token);
			structureChanged = true;
		}
	}

	if (structureChanged) {
		lineEl.replaceChildren(...finalEls);
	}
	// If !structureChanged, all existing elements were reused in place and
	// already updated — no DOM structure change needed.
}

/**
 * Patch multiple line elements at once.
 *
 * Only lines whose `block.lineIndex` appears in `changedLineIndices` are
 * patched. All others are left untouched. Pass `null` to patch every line.
 *
 * Line elements are looked up via `[data-md-line="N"]` within `editorEl`.
 * Lines whose elements are not found (not yet rendered) are silently skipped.
 *
 * @param {Element}                      editorEl
 * @param {Block[]}                      newBlocks
 * @param {InlineToken[][]}              newTokensByLine  - Indexed by lineIndex
 * @param {Set<number> | null}           [changedLineIndices]
 * @param {object}                       [options]
 * @param {(token: InlineToken) => Element} [options.createElement]
 */
export function patchEditor(
	editorEl,
	newBlocks,
	newTokensByLine,
	changedLineIndices = null,
	options = {},
) {
	const { LINE_ATTR } = /** @type {{ LINE_ATTR: string }} */ (
		// Dynamic import is impractical here; inline the attribute name for self-containment
		{ LINE_ATTR: 'data-md-line' }
	);

	for (const block of newBlocks) {
		if (changedLineIndices !== null && !changedLineIndices.has(block.lineIndex)) {
			continue;
		}

		const lineEl = editorEl.querySelector(`[${LINE_ATTR}="${block.lineIndex}"]`);
		if (!lineEl) continue;

		patchLine(lineEl, block, newTokensByLine[block.lineIndex] ?? [], options);
	}
}
