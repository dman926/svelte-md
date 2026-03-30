/**
 * Pure cursor-mapping math — no DOM, no side effects.
 *
 * These functions translate between raw markdown space (byte offsets in
 * `block.raw`) and rendered DOM space (character offsets in an inline token's
 * `content` text node). They are the computational core that both `capture.js`
 * and `restore.js` depend on.
 *
 * ## The prefix length
 *
 * Every inline token that isn't plain `text` has syntax characters surrounding
 * its content: `**bold**` has two `*` characters before and after `bold`.
 * These characters exist in raw space but are absent from the rendered DOM.
 * The *prefix length* is the count of leading syntax characters — the delta
 * between the token's `start` in raw space and the position of the first
 * rendered character.
 *
 * | Token type   | Example raw      | Prefix | Suffix | Formula             |
 * |--------------|------------------|--------|--------|---------------------|
 * | `text`       | `hello`          | 0      | 0      | hardcoded           |
 * | `escape`     | `\*`             | 1      | 0      | hardcoded           |
 * | `link`       | `[text](url)`    | 1      | `](url)`.len | hardcoded    |
 * | `image`      | `![alt](url)`    | 2      | `](url)`.len | hardcoded    |
 * | `italic`     | `*hi*`           | 1      | 1      | (raw−content)/2     |
 * | `bold`       | `**hi**`         | 2      | 2      | (raw−content)/2     |
 * | `bold_italic`| `***hi***`       | 3      | 3      | (raw−content)/2     |
 * | `code`       | `` `hi` ``       | 1      | 1      | (raw−content)/2     |
 * | `code`+space | `` ` hi ` ``     | 2      | 2      | (raw−content)/2     |
 * | `strike`     | `~~hi~~`         | 2      | 2      | (raw−content)/2     |
 * | custom (sym) | `==hi==`         | 2      | 2      | (raw−content)/2     |
 * | custom (asym)| `{@hi}`          | ½ → 0  | —      | fallback 0          |
 *
 * The symmetric formula `(raw.length − content.length) / 2` works because
 * every symmetric token has equal-length opening and closing delimiters.
 * `escape` and `link`/`image` are asymmetric and need explicit constants.
 * Custom tokens with non-integer results fall back to 0.
 */

/**
 * @typedef {import('./types.js').RawPoint}       RawPoint
 * @typedef {import('./types.js').RawSelection}   RawSelection
 * @typedef {import('./types.js').DomOffsetResult} DomOffsetResult
 * @typedef {import('../parser/types.js').InlineToken} InlineToken
 */

// ---------------------------------------------------------------------------
// Prefix length
// ---------------------------------------------------------------------------

/**
 * Return the number of leading syntax characters in `token.raw` that are
 * **not rendered** in the token's DOM text node — i.e., the byte distance
 * between `token.start` and the first rendered character.
 *
 * This value is the key delta in all raw ↔ DOM offset conversions.
 *
 * @param {InlineToken} token
 * @returns {number}
 */
export function getTokenPrefixLen(token) {
	switch (token.type) {
		// Plain text: every raw character is rendered directly.
		case 'text':
			return 0;

		// Escape `\X`: the backslash is not rendered; only the escaped char is.
		case 'escape':
			return 1;

		// Link `[label](url)`: only `label` is rendered; prefix = `[` (1 char).
		case 'link':
			return 1;

		// Image `![alt](url)`: only `alt` is rendered; prefix = `![` (2 chars).
		case 'image':
			return 2;

		// All other built-in token types are symmetric (same opener and closer).
		// `italic`   (*/*/)       : (raw − content) / 2 = 1
		// `bold`     (**/**/)     : (raw − content) / 2 = 2
		// `bold_italic` (***/***/): (raw − content) / 2 = 3
		// `code`     (` ` / ``...``): (raw − content) / 2 = N ticks [± 1 space]
		// `strike`   (~~/ custom) : (raw − content) / 2 = delimLen
		// Custom symmetric rules follow the same pattern.
		default: {
			const half = (token.raw.length - token.content.length) / 2;
			// Guard: must be a non-negative integer. If not (asymmetric custom rule),
			// fall back to 0 — treat the cursor as being at the token start.
			return Number.isInteger(half) && half >= 0 ? half : 0;
		}
	}
}

// ---------------------------------------------------------------------------
// Raw → DOM
// ---------------------------------------------------------------------------

/**
 * Map a raw-space column (`rawCol`, absolute within `block.raw`) to a
 * character offset within the token's rendered text node (`domOffset`).
 *
 * The mapping clamps `rawCol` to the token's *content region*:
 * - Positions within the opening syntax chars snap to `domOffset = 0`.
 * - Positions within the closing syntax chars snap to `domOffset = content.length`.
 * - Positions within the content map exactly.
 *
 * The `clamp` field on the result tells callers whether snapping occurred,
 * which is useful for deciding whether the cursor should prefer the *next*
 * token's start position over this token's end position.
 *
 * @param {InlineToken} token
 * @param {number} rawCol - Absolute byte offset within `block.raw`.
 *   Must satisfy `token.start <= rawCol <= token.end`.
 * @returns {DomOffsetResult}
 */
export function rawColToDomOffset(token, rawCol) {
	const prefixLen = getTokenPrefixLen(token);
	const contentStart = token.start + prefixLen;
	const contentEnd = contentStart + token.content.length;

	if (rawCol < contentStart) {
		return { domOffset: 0, clamp: 'before' };
	}
	if (rawCol >= contentEnd) {
		return { domOffset: token.content.length, clamp: 'after' };
	}
	return { domOffset: rawCol - contentStart, clamp: 'within' };
}

// ---------------------------------------------------------------------------
// DOM → Raw
// ---------------------------------------------------------------------------

/**
 * Map a DOM character offset (within a token's rendered text node) back to
 * an absolute raw-space column within `block.raw`.
 *
 * This is the inverse of `rawColToDomOffset`. `domOffset` must be in
 * `[0, token.content.length]`.
 *
 * @param {InlineToken} token
 * @param {number} domOffset - Character offset within the token's text node.
 * @returns {number} Absolute byte offset within `block.raw`.
 */
export function domOffsetToRawCol(token, domOffset) {
	const prefixLen = getTokenPrefixLen(token);
	const contentStart = token.start + prefixLen;
	const clamped = Math.max(0, Math.min(domOffset, token.content.length));
	return contentStart + clamped;
}

// ---------------------------------------------------------------------------
// Token lookup
// ---------------------------------------------------------------------------

/**
 * Find the inline token that "owns" the given raw column.
 *
 * Tokens cover the inline content region of a line without gaps. This
 * function finds the token where `token.start <= rawCol < token.end`.
 *
 * **Boundary rule:** when `rawCol` exactly equals `token.end`, that column
 * is treated as belonging to the *current* token (at its closing edge) rather
 * than the next token. This preserves cursor stability when the cursor sits
 * just before a syntax boundary.
 *
 * Falls back to the *last* token if `rawCol` is at or past all token ends
 * (e.g., `rawCol === lastToken.end` at end-of-line).
 *
 * Returns `null` if `tokens` is empty.
 *
 * @param {InlineToken[]} tokens - Ordered, non-overlapping token array for one line.
 * @param {number} rawCol        - Absolute byte offset within `block.raw`.
 * @returns {InlineToken | null}
 */
export function findTokenAtRawCol(tokens, rawCol) {
	if (tokens.length === 0) return null;
	for (const token of tokens) {
		if (rawCol < token.end) return token;
	}
	return tokens[tokens.length - 1];
}

/**
 * Find a token by its `start` value (the raw byte offset of its first character).
 *
 * This is used during DOM→raw capture: the DOM element stores the token's
 * `start` as a `data-md-token` attribute, and we use that to look up the
 * full token object.
 *
 * Returns `null` if no token with that `start` exists.
 *
 * @param {InlineToken[]} tokens
 * @param {number} start - The `token.start` value to search for.
 * @returns {InlineToken | null}
 */
export function findTokenByStart(tokens, start) {
	return tokens.find((t) => t.start === start) ?? null;
}

// ---------------------------------------------------------------------------
// RawSelection factory helpers
// ---------------------------------------------------------------------------

/**
 * Create a collapsed `RawSelection` (caret only — no selected text).
 *
 * @param {number} line
 * @param {number} col
 * @returns {RawSelection}
 */
export function makeCollapsedSelection(line, col) {
	return { anchor: { line, col }, focus: { line, col }, isCollapsed: true };
}

/**
 * Create a `RawSelection` from two raw points.
 * The `isCollapsed` field is computed automatically.
 *
 * @param {RawPoint} anchor
 * @param {RawPoint} focus
 * @returns {RawSelection}
 */
export function makeSelection(anchor, focus) {
	const isCollapsed = anchor.line === focus.line && anchor.col === focus.col;
	return { anchor, focus, isCollapsed };
}

/**
 * Return `true` if two `RawPoint` values refer to the same position.
 *
 * @param {RawPoint} a
 * @param {RawPoint} b
 * @returns {boolean}
 */
export function pointsEqual(a, b) {
	return a.line === b.line && a.col === b.col;
}

/**
 * Clamp a `RawPoint` so that `col` stays within `[0, block.raw.length]`.
 * Returns a new point; does not mutate the input.
 *
 * @param {RawPoint} point
 * @param {import('../parser/types.js').Block[]} blocks
 * @returns {RawPoint}
 */
export function clampPoint(point, blocks) {
	const block = blocks.find((b) => b.lineIndex === point.line);
	if (!block) return point;
	return {
		line: point.line,
		col: Math.max(0, Math.min(point.col, block.raw.length)),
	};
}
