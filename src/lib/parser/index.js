/**
 * @import { Parser, ParserOptions, Document, EditRange, BlockNode } from './types';
 */

import { createBlockParser, shiftRanges } from './block';
import { createInlineParser } from './inline';

export * from './types';
export {
	thematicBreakRule,
	headingRule,
	codeBlockRule,
	blockquoteRule,
	listItemRule,
	paragraphRule,
} from './block';
export { walk, walkInline, find, findBlockAt, findInlineAt, serialize } from './utils';

/**
 * Create a fully configured parser with both `parse` and `update` methods.
 *
 * ## Initial parse
 * ```js
 * const parser = createParser();
 * const doc = parser.parse('> # Hello\n\n- **item**\n\n```js\ncode\n```');
 * ```
 *
 * ## Incremental update
 *
 * When source text changes, call `update` instead of `parse` to reuse
 * unchanged parts of the existing tree. The edit is described as the
 * 0-based line range that was replaced and the line count delta:
 *
 * ```js
 * // User inserted a new line at line 3 (adds 1 line):
 * const newDoc = parser.update(oldDoc, newSource, {
 *   startLine: 3,
 *   endLine: 3,
 *   deltaLines: 1,
 * });
 *
 * // User deleted lines 5–7 (removes 3 lines):
 * const newDoc = parser.update(oldDoc, newSource, {
 *   startLine: 5,
 *   endLine: 7,
 *   deltaLines: -3,
 * });
 * ```
 *
 * Nodes outside the affected region are the same object references as in
 * `oldDoc` (safe to diff/cache in a renderer).
 *
 * ## Plugin examples
 * ```js
 * // Custom block rule
 * const calloutRule = {
 *   name: 'callout',
 *   priority: 35,
 *   isContainer: false,
 *   tryStart(line, ctx) {
 *     const m = line.match(/^:::(info|warn|error)\s*(.*)/);
 *     if (!m) return null;
 *     return { node: { type: 'callout', kind: m[1], range: ..., rawLines: [m[2]] } };
 *   },
 *   tryContinue(line, node) {
 *     if (line.trim() == ':::') return null;
 *     node.rawLines.push(line);
 *     return { remainder: line, remainderOffset: 0 };
 *   },
 * };
 *
 * // Custom inline rule
 * const mentionRule = {
 *   name: 'mention',
 *   scan(raw, pos, end) {
 *     if (raw[pos] != '@') return null;
 *     const m = raw.slice(pos).match(/^@([\w-]+)/);
 *     if (!m) return null;
 *     const endPos = pos + m[0].length;
 *     return { type: 'mention', handle: m[1], range: { start: pos, end: endPos }, _end: endPos };
 *   },
 * };
 *
 * const parser = createParser({
 *   block:  { rules: [calloutRule] },
 *   inline: { rules: [mentionRule] },
 * });
 * ```
 *
 * @param {ParserOptions} [options]
 * @returns {Parser}
 */
export const createParser = (options = {}) => {
	const blockParser = createBlockParser(options.block);
	const inlineParser = createInlineParser(options.inline);

	return {
		parse: (source) => {
			const root = blockParser.parseBlocks(source);
			inlineParser.populateInline(root);
			return root;
		},

		/**
		 * Incrementally re-parse after an edit, reusing unchanged nodes.
		 *
		 * ## Algorithm
		 *
		 * 1. Find the first top-level block whose range overlaps `edit.startLine`.
		 *    Expand back to its `.range.start.line` so we re-parse from a clean
		 *    block boundary.
		 * 2. Find the last top-level block whose range overlaps
		 *    `edit.endLine + edit.deltaLines` (the end of the edit in the new source).
		 *    Expand forward to its `.range.end.line + deltaLines`.
		 * 3. Re-parse only those lines from `newSource`.
		 * 4. Adjust source positions on the "after" blocks by `deltaLines`.
		 * 5. Return a new Document splicing before + new + after blocks.
		 *
		 * If the edit is entirely past the last existing block, just re-parse the
		 * new trailing content and append it.
		 *
		 * @param {Document}  oldDoc
		 * @param {string}    newSource
		 * @param {EditRange} edit
		 * @returns {Document}
		 */
		update(oldDoc, newSource, edit) {
			const { startLine, endLine, deltaLines } = edit;
			const newLines = newSource.split('\n');

			const top = oldDoc.children;

			// ── Find first affected top-level block ──────────────────────────
			// A block is "affected" if its range might be invalidated by the edit.
			// This includes blocks that START before or AT the first changed line
			// (a container might span both changed and unchanged lines).
			let firstAffIdx = top.findIndex((b) => b.range.end.line >= startLine);
			if (firstAffIdx == -1) {
				// All existing blocks end before the edit — re-parse only the new tail.
				const reparseStart = top.length > 0 ? top[top.length - 1].range.end.line + 1 : 0;
				const tailSource = newLines.slice(reparseStart).join('\n');
				if (!tailSource.trim()) {
					// Nothing new to parse — update the document range and return.
					return buildDoc(top, newSource.length);
				}
				const tailDoc = blockParser.parseBlocks(tailSource);
				inlineParser.populateInline(tailDoc);
				shiftRangesInDoc(
					tailDoc.children,
					reparseStart,
					tailSource.length -
						newSource.length +
						/* offset of tail */ computeOffset(newLines, reparseStart),
				);
				return buildDoc([...top, ...tailDoc.children], newSource.length);
			}

			// Expand start back to the block boundary.
			const reparseFromLine = top[firstAffIdx].range.start.line;

			// ── Find last affected top-level block ───────────────────────────
			// In the NEW source's line numbers, the edit extends to endLine + deltaLines.
			const editEndInNew = endLine + Math.max(0, deltaLines);
			let lastAffIdx = top.length - 1;
			for (let i = top.length - 1; i >= firstAffIdx; i--) {
				if (top[i].range.start.line <= endLine) {
					lastAffIdx = i;
					break;
				}
			}
			const reparseToLine = Math.min(
				newLines.length - 1,
				top[lastAffIdx].range.end.line + Math.max(0, deltaLines),
			);

			// ── Re-parse the affected slice ──────────────────────────────────
			const sliceSource = newLines.slice(reparseFromLine, reparseToLine + 1).join('\n');
			const sliceDoc = blockParser.parseBlocks(sliceSource);
			inlineParser.populateInline(sliceDoc);

			// Shift new-middle blocks to their absolute line numbers.
			const sliceOffset = computeOffset(newLines, reparseFromLine);
			shiftRangesInDoc(sliceDoc.children, reparseFromLine, sliceOffset);

			// ── Build before/after unchanged block lists ─────────────────────
			const keepBefore = top.slice(0, firstAffIdx);
			const keepAfter = top.slice(lastAffIdx + 1);

			// Shift after-blocks by deltaLines (their absolute positions changed).
			if (deltaLines != 0) {
				const afterOffset =
					computeOffset(newLines, reparseToLine + 1) -
					computeOffset(
						newLines.slice(0, newLines.length - deltaLines),
						reparseToLine + 1 - deltaLines,
					);
				for (const b of keepAfter) shiftRanges(b, deltaLines, afterOffset);
			}

			return buildDoc([...keepBefore, ...sliceDoc.children, ...keepAfter], newSource.length);
		},

		get options() {
			return options;
		},
	};
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the byte offset of the start of line `lineIndex` within a source
 * that is `lines` split by '\n'.
 * @param {string[]} lines
 * @param {number}   lineIndex
 * @returns {number}
 */
const computeOffset = (lines, lineIndex) => {
	let off = 0;
	for (let i = 0; i < lineIndex && i < lines.length; i++) {
		off += lines[i].length + 1; // +1 for the '\n'
	}
	return off;
};

/**
 * Shift all block nodes' ranges by `deltaLines` and correct their offsets
 * to be absolute (they were parsed relative to offset 0 within the slice).
 *
 * @param {BlockNode[]} nodes
 * @param {number}      deltaLines   Lines to add to every range.
 * @param {number}      absoluteStart  Absolute byte offset of the slice start.
 */
const shiftRangesInDoc = (nodes, deltaLines, absoluteStart) => {
	for (const node of nodes) {
		shiftRanges(node, deltaLines, absoluteStart);
	}
};

/**
 * Build a Document node from a list of top-level children.
 * @param {BlockNode[]} children
 * @param {number}      sourceLength
 * @returns {Document}
 */
const buildDoc = (children, sourceLength) => ({
	type: 'document',
	range: {
		start: { line: 0, offset: 0 },
		end: {
			line: children.length > 0 ? children[children.length - 1].range.end.line : 0,
			offset: sourceLength,
		},
	},
	raw: children.map(({ raw }) => raw).join('\n'),
	children,
});

/** @type {Parser} */
export const defaultParser = createParser();
