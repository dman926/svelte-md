/**
 * Cursor module — public re-exports.
 *
 * The cursor module bridges the gap between the browser's DOM-based
 * `Selection` API and the editor's raw markdown source positions.
 *
 * ## Quick reference
 *
 * ```js
 * import {
 *   captureSelection,        // DOM Selection → RawSelection
 *   restoreSelection,        // RawSelection → DOM Selection
 *   resolvePointToRange,     // RawPoint → DOM Range (no side-effects)
 *   getTokenPrefixLen,       // how many syntax chars precede token.content
 *   rawColToDomOffset,       // raw byte offset → text node char offset
 *   domOffsetToRawCol,       // text node char offset → raw byte offset
 *   findTokenAtRawCol,       // which token owns this raw column?
 *   findTokenByStart,    RawSelection    // look up token by its .start value
 *   makeCollapsedSelection,  // { line, col } → collapsed RawSelection
 *   makeSelection,           // anchor + focus → RawSelection
 *   pointsEqual,             // compare two RawPoints
 *   clampPoint,              // clamp col to block.raw bounds
 *   LINE_ATTR,               // 'data-md-line'
 *   TOKEN_ATTR,              // 'data-md-token'
 * } from './cursor/index.js';
 * ```
 *
 * ## Typical render-cycle usage
 *
 * ```js
 * // 1. Before mutating the DOM (e.g. in a beforeinput handler):
 * let savedCursor = captureSelection(editorEl, tokensByLine);
 *
 * // 2. Mutate raw markdown state, re-tokenise, patch the DOM …
 *
 * // 3. Immediately after the DOM patch:
 * if (savedCursor) {
 *   restoreSelection(editorEl, savedCursor, tokensByLine);
 * }
 * ```
 *
 * ## DOM attribute contract
 *
 * The rendering layer must apply:
 * - `data-md-line="N"` on each block's line container (N = `block.lineIndex`)
 * - `data-md-token="M"` on each inline token wrapper (M = `token.start`)
 *
 * Opaque blocks (code fence bodies, HR, blank) should have **no**
 * `data-md-token` elements; their cursor positions map 1:1 from DOM to raw.
 */

// Types (re-exported as values for the string constants)
export * from './types.js';

// Pure math — no DOM
export {
	getTokenPrefixLen,
	rawColToDomOffset,
	domOffsetToRawCol,
	findTokenAtRawCol,
	findTokenByStart,
	makeCollapsedSelection,
	makeSelection,
	pointsEqual,
	clampPoint,
} from './map.js';

// DOM read
export { captureSelection } from './capture.js';

// DOM write
export { restoreSelection, resolvePointToRange } from './restore.js';
