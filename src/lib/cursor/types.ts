/**
 * Types for the raw-space cursor system.
 *
 * The fundamental design principle: cursor positions are always stored and
 * manipulated in **raw markdown space** (byte offsets within `block.raw`),
 * never in DOM space (character offsets within rendered text nodes). This
 * decouples cursor math from the rendering layer and eliminates the
 * off-by-one errors that arise from syntax characters that exist in the
 * source but are invisible in the rendered output.
 */

// ---------------------------------------------------------------------------
// Core position types
// ---------------------------------------------------------------------------

/**
 * A single cursor position in raw markdown space.
 *
 * - `line` is the 0-based index of the line (corresponds to `block.lineIndex`)
 * - `col` is the byte offset within `block.raw` for that line (inclusive)
 *
 * `col` may point at any byte in `block.raw`, including bytes that correspond
 * to syntax characters (`*`, `[`, `` ` ``) that are not rendered in the DOM.
 * The restore functions handle snapping to the nearest rendered position.
 *
 * @example
 * // For the line "## Hello **world**", lineIndex = 0:
 * // col 0 → before the first `#`
 * // col 2 → after "## " prefix, before "H"
 * // col 8 → at "**" prefix of bold (snaps to start of "world" in DOM)
 * // col 11 → inside "world" content, between 'o' and 'r'
 */
export interface RawPoint {
	/** 0-based line index. Corresponds to `block.lineIndex`. */
	line: number;
	/** Byte offset within `block.raw` for this line. Inclusive. */
	col: number;
}

/**
 * A selection in raw markdown space — a pair of anchor and focus endpoints.
 *
 * The anchor is where the selection *started* (mousedown, or where the user
 * began shift-extending). The focus is where the selection *ends* (current
 * caret position). For a collapsed cursor (no selected text), anchor === focus.
 *
 * Matches the semantics of the browser's `Selection` API.
 *
 * @example
 * // Collapsed cursor at line 1, column 5:
 * // { anchor: { line: 1, col: 5 }, focus: { line: 1, col: 5 }, isCollapsed: true }
 *
 * @example
 * // Selection from col 3 to col 10 on line 2 (left-to-right drag):
 * // { anchor: { line: 2, col: 3 }, focus: { line: 2, col: 10 }, isCollapsed: false }
 *
 * @example
 * // Cross-line selection (anchor at end of line 0, focus at start of line 2):
 * // { anchor: { line: 0, col: 11 }, focus: { line: 2, col: 0 }, isCollapsed: false }
 */
export interface RawSelection {
	/** Where the selection started (may be at the *end* of the selection for RTL drags). */
	anchor: RawPoint;
	/** Where the selection ends (the caret position). */
	focus: RawPoint;
	/**
	 * `true` when anchor and focus are the same position (no text selected).
	 * This is always `anchor.line === focus.line && anchor.col === focus.col`.
	 */
	isCollapsed: boolean;
}

// ---------------------------------------------------------------------------
// Cursor math intermediate types
// ---------------------------------------------------------------------------

/**
 * The result of mapping a raw-space column to a rendered DOM offset within
 * a single inline token's text node.
 *
 * Returned by `rawColToDomOffset`. Callers use `domOffset` to place a `Range`
 * endpoint into the token's text node.
 */
export interface DomOffsetResult {
	/**
	 * The character offset within the token's rendered text node.
	 * Always in `[0, token.content.length]`.
	 */
	domOffset: number;

	/**
	 * How the rawCol was resolved relative to the token's content region:
	 * - `'before'` — rawCol fell within the opening syntax (prefix chars);
	 *    clamped to `0`.
	 * - `'within'` — rawCol fell within the rendered content; exact mapping.
	 * - `'after'`  — rawCol fell within the closing syntax (suffix chars);
	 *    clamped to `token.content.length`.
	 */
	clamp: 'before' | 'within' | 'after';
}

// ---------------------------------------------------------------------------
// DOM attribute contract
// ---------------------------------------------------------------------------

/**
 * The data attributes the cursor module reads from and writes to the DOM.
 *
 * These must be applied by the Svelte rendering layer on each line container
 * and each token wrapper. The cursor module makes no assumptions about any
 * other DOM structure.
 *
 * ```html
 * <!-- Line container — one per block -->
 * <div data-md-line="2" contenteditable="true">
 *
 *   <!-- Token wrapper — one per inline token -->
 *   <span data-md-token="6">world</span>
 *   <strong data-md-token="12">bold</strong>
 *
 *   <!-- Opaque line — no token wrappers -->
 *   <span>const x = 1;</span>
 *
 * </div>
 * ```
 *
 * The value of `data-md-line` is the block's `lineIndex` (0-based).
 * The value of `data-md-token` is the token's `start` offset in `block.raw`.
 */
export interface DomAttributeContract {
	/**
	 * Applied to the line container element.
	 * Value: `block.lineIndex` as a decimal string.
	 */
	line: 'data-md-line';

	/**
	 * Applied to each inline token wrapper element.
	 * Value: `token.start` (raw byte offset) as a decimal string.
	 */
	token: 'data-md-token';
}

/** The data attribute name placed on each line container element. */
export const LINE_ATTR = 'data-md-line' as const;

/** The data attribute name placed on each token wrapper element. */
export const TOKEN_ATTR = 'data-md-token' as const;
