/**
 * DOM → raw markdown serializer.
 *
 * Reads the current DOM state of a rendered editor and reconstructs the
 * canonical raw markdown string. This is the inverse of the rendering step.
 *
 * ## When is this called?
 *
 * The editor uses a **model-first** approach: simple keystrokes (insertText,
 * deleteContent, Enter) are applied directly to the raw string without ever
 * reading the DOM back. The serializer is only needed as a fallback for
 * operations the browser handles itself before we can intercept them:
 *
 * - **Paste** (`insertFromPaste`) — browser inserts arbitrary content
 * - **IME composition** — browser inserts composed characters on `compositionend`
 * - **Spellcheck / autocorrect** — browser mutates text nodes
 * - **Drag-and-drop** — browser rearranges content
 *
 * In these cases, the `input` event fires after the DOM has already been
 * mutated. The serializer reads the result back and lets the parser produce
 * a clean new model state.
 *
 * ## How it works
 *
 * For each line element (`[data-md-line]`), the serializer:
 *
 * 1. Returns `''` for blank lines.
 * 2. Returns `element.textContent` for opaque blocks (code fence open/body/close,
 *    HR) — these render their raw text directly with no syntax wrapping.
 * 3. For tokenized blocks, walks each direct child of the line element:
 *    - If the child has `[data-md-token="M"]` AND token M exists in the current
 *      token array: reconstruct `openDelim + newTextContent + closeDelim` using
 *      the original token's delimiter structure.
 *    - Otherwise (unexpected element or direct text node): use `.textContent`
 *      as plain text — this handles any content the browser inserted outside
 *      of our token elements.
 *    Prepends the block-level prefix (`## `, `> `, `- `, etc.) from the
 *    original block's `raw` string.
 *
 * ## Delimiter reconstruction
 *
 * Each token carries enough information to reconstruct its delimiters:
 *
 * | Token type   | openDelim   | closeDelim       |
 * |--------------|-------------|------------------|
 * | `text`       | `''`        | `''`             |
 * | `escape`     | `'\'`      | `''`             |
 * | `italic`     | `'*'`       | `'*'`            |
 * | `bold`       | `'**'`      | `'**'`           |
 * | `code`       | `` '`' ``   | `` '`' ``        |
 * | `link`       | `'['`       | `'](url)'`       |
 * | `image`      | `'!['`      | `'](url)'`       |
 * | custom (sym) | `'=='`      | `'=='`           |
 *
 * The formula `suffixLen = raw.length − content.length − prefixLen` yields the
 * correct close delimiter for every token type, including asymmetric ones like
 * `link` and `image` (where the close contains the preserved URL).
 */

/** @import { Block, InlineToken } from '../parser/types'; */

import { TOKEN_ATTR, LINE_ATTR } from '../cursor/types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Block types that render their raw content verbatim with no inline tokens. */
const OPAQUE_TYPES = new Set(['code_fence_open', 'code_fence_body', 'code_fence_close', 'hr']);

/**
 * @param {Block} block
 * @returns {boolean}
 */
function isOpaque(block) {
	return OPAQUE_TYPES.has(block.type);
}

/**
 * Compute the opening and closing delimiter strings for a token.
 *
 * | Token type       | open    | close             |
 * |------------------|---------|-------------------|
 * | `text`           | `''`    | `''`              |
 * | `escape`         | `'\'`  | `''`              |
 * | `link`           | `'['`   | `'](url)'`        |
 * | `image`          | `'!['`  | `'](url)'`        |
 * | symmetric built-in / custom | prefix | mirror suffix |
 * | asymmetric custom (non-integer half) | `''` | `''` |
 *
 * For symmetric tokens the formula is:
 *   `half = (raw.length − content.length) / 2`
 *   `open  = raw.slice(0, half)`
 *   `close = raw.slice(raw.length − half)`
 *
 * This correctly handles code tokens with the CommonMark space-strip where
 * open = `` '` ' `` and close = `` ' `' `` (they're mirrors, not identical).
 *
 * When `half` is not an integer, the token is an asymmetric custom rule whose
 * raw structure cannot be safely inferred. Both delimiters fall back to `''`
 * so the serialiser emits only the text content — the re-parser will then
 * produce plain text from it, which is better than corrupted syntax.
 *
 * @param {InlineToken} token
 * @returns {{ open: string, close: string }}
 */
function getTokenDelimiters(token) {
	// Asymmetric cases with known structure
	switch (token.type) {
		case 'escape':
			return { open: '\\', close: '' };
		case 'link':
			return { open: '[', close: `](${token.href ?? ''})` };
		case 'image':
			return { open: '![', close: `](${token.href ?? ''})` };
		default: {
			// Symmetric tokens: open and close are mirror halves of the raw string.
			// text    → half=0  → open='',   close=''
			// italic  → half=1  → open='*',  close='*'
			// bold    → half=2  → open='**', close='**'
			// code ` hi ` → half=2 → open='` ', close=' `'
			const half = (token.raw.length - token.content.length) / 2;
			if (!Number.isInteger(half) || half < 0) {
				// Asymmetric custom token — both delimiters are unknown; emit content only.
				return { open: '', close: '' };
			}
			return {
				open: token.raw.slice(0, half),
				close: half > 0 ? token.raw.slice(token.raw.length - half) : '',
			};
		}
	}
}

/**
 * Find the token whose `start` matches `tokenStart`.
 * Returns `null` when out of sync (e.g. browser added an element we don't know).
 *
 * @param {InlineToken[] | null | undefined} tokens
 * @param {number} tokenStart
 * @returns {InlineToken | null}
 */
function findToken(tokens, tokenStart) {
	if (!tokens) return null;
	return tokens.find((t) => t.start === tokenStart) ?? null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reconstruct the raw markdown string for a single line from its DOM element.
 *
 * The `tokens` argument should be the token array that was used to render
 * `lineEl` **before** the browser mutation — i.e., the current model state,
 * not a newly re-parsed state. This lets the serializer look up each token
 * element's original delimiter structure.
 *
 * @param {Element}                            lineEl       - `[data-md-line]` element
 * @param {Block}                              block        - The block that owns this line
 * @param {InlineToken[] | null | undefined}   tokens       - Token array for this line
 * @param {number}                             contentStart - From `parser.getBlockContentStart(block)`
 * @returns {string}
 */
export function serializeLine(lineEl, block, tokens, contentStart) {
	// ── Blank line ────────────────────────────────────────────────────────────
	if (block.type === 'blank') return '';

	// ── Opaque block — raw text rendered verbatim ─────────────────────────────
	if (isOpaque(block)) {
		return lineEl.textContent ?? block.raw;
	}

	// ── Tokenized block ────────────────────────────────────────────────────────
	// The block-level prefix (e.g. '## ', '> ', '- ') lives in the raw string
	// but is not inside any token element. We preserve it exactly from the
	// original block.raw so that block-level syntax is never lost.
	const blockPrefix = block.raw.slice(0, contentStart);

	let inlineContent = '';

	for (const child of lineEl.childNodes) {
		// ── Text node (browser inserted content outside a token element) ─────────
		if (child.nodeType === Node.TEXT_NODE) {
			inlineContent += child.nodeValue ?? '';
			continue;
		}

		// ── Element node ──────────────────────────────────────────────────────────
		if (child.nodeType === Node.ELEMENT_NODE) {
			const el = /** @type {Element} */ (child);
			const tokenAttr = el.getAttribute(TOKEN_ATTR);

			if (tokenAttr !== null) {
				// Element with data-md-token: look up original token for delimiter info
				const tokenStart = parseInt(tokenAttr, 10);
				const token = findToken(tokens, tokenStart);

				if (token) {
					const { open, close } = getTokenDelimiters(token);
					inlineContent += open + (el.textContent ?? '') + close;
				} else {
					// Token no longer in our model (shouldn't happen in normal flow) —
					// fall back to raw text content.
					inlineContent += el.textContent ?? '';
				}
			} else {
				// Element without data-md-token (e.g. unexpected browser insertion) —
				// use its text content as plain markdown.
				inlineContent += el.textContent ?? '';
			}
		}
	}

	return blockPrefix + inlineContent;
}

/**
 * Reconstruct the full raw markdown document string from the editor DOM.
 *
 * Iterates over all blocks and serializes each line in order, joining with
 * `\n`. Falls back to `block.raw` for any line whose element is missing from
 * the DOM.
 *
 * @param {Element}     editorEl      - The root `contenteditable` element
 * @param {Block[]}     blocks        - Current block model (pre-mutation)
 * @param {(InlineToken[] | null | undefined)[]} tokensByLine
 *   Indexed by `block.lineIndex`. The token arrays used to render the current DOM.
 * @param {number[]}    contentStarts - `parser.getBlockContentStart(block)` per line
 * @returns {string}
 */
export function serializeEditor(editorEl, blocks, tokensByLine, contentStarts) {
	const lines = [];

	for (const block of blocks) {
		const lineEl = editorEl.querySelector(`[${LINE_ATTR}="${block.lineIndex}"]`);

		if (!lineEl) {
			// Element not in DOM (shouldn't happen) — preserve original raw
			lines.push(block.raw);
			continue;
		}

		lines.push(
			serializeLine(
				lineEl,
				block,
				tokensByLine[block.lineIndex],
				contentStarts[block.lineIndex] ?? 0,
			),
		);
	}

	return lines.join('\n');
}

/**
 * Compute a `contentStarts` array parallel to `blocks`.
 * Each entry is the result of `parser.getBlockContentStart(block)`.
 *
 * This array is needed by `serializeEditor` and should be precomputed once
 * per render cycle to avoid repeated calls.
 *
 * @param {Block[]} blocks
 * @param {{ getBlockContentStart: (block: Block) => number }} parser
 * @returns {number[]}
 */
export function buildContentStarts(blocks, parser) {
	return blocks.map((b) => parser.getBlockContentStart(b));
}
