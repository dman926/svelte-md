/**
 * Block-level parser — Phase 1 of the parse pipeline.
 *
 * Implements the CommonMark open-block-stack algorithm:
 *
 *   For each source line:
 *     Phase 1 — try to continue each open block (innermost first).
 *               Lazy continuation: a bare non-interrupting line can extend
 *               an open paragraph without repeating container markers.
 *     Phase 2 — close any blocks that couldn't continue.
 *     Phase 3 — try to open new blocks with the remaining content.
 *
 * Code fence open/body/close is handled via `result.close` on the fence
 * rule's tryContinue, which tells the loop the closing fence was consumed
 * and Phase 3 must not re-examine the line.
 *
 * List items are wrapped in an implicit List container node by `wrapInList`.
 *
 * ## Plugin system
 *
 * Block rules implement `BlockRule` (see types.ts) and are merged with the
 * built-ins by ascending `priority`. Built-in rules are named exports so
 * library consumers can reference, wrap, or replace them.
 *
 * Priority reference:
 *   10  thematic_break
 *   20  heading
 *   30  code_block
 *   40  blockquote
 *   50  list_item
 *  999  paragraph
 */

import { isParentBlock } from './utils';

/**
 * @import {
 *   BlockNode, Document, Blockquote, List,
 *   ListItem, Heading, Paragraph, CodeBlock, ThematicBreak,
 *   BlockRule, BlockRuleContext, BlockParserOptions,
 *   NodeRange, Position,
 * } from './types';
 */

// ---------------------------------------------------------------------------
// Regexes
// ---------------------------------------------------------------------------

const BLANK_RE = /^\s*$/;
const HEADING_RE = /^(#{1,6})([ \t].*|$)/;
const THEMATIC_RE = /^[ \t]{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BLOCKQUOTE_RE = /^[ \t]{0,3}>/;
const UL_RE = /^([ \t]*)([-*+])(?:[ \t])(.*)/;
const OL_RE = /^([ \t]*)(\d{1,9})([.)]) +(.*)/;
const FENCE_OPEN_RE = /^([ \t]{0,3})((`{3,})|(~{3,}))([ \t]*)(.*)/;
const FENCE_CLOSE_RE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/;

// ---------------------------------------------------------------------------
// Position / range helpers
// ---------------------------------------------------------------------------

/** @param {number} line @param {number} offset @returns {Position} */
const mkPos = (line, offset) => ({ line, offset });

/**
 * @param {number} sl @param {number} so @param {number} el @param {number} eo
 * @returns {NodeRange}
 */
const mkRange = (sl, so, el, eo) => ({ start: mkPos(sl, so), end: mkPos(el, eo) });

// ---------------------------------------------------------------------------
// Built-in block rules
// ---------------------------------------------------------------------------

// ── Thematic break ──────────────────────────────────────────────────────────

/** @type {BlockRule} */
export const thematicBreakRule = {
	name: 'thematic_break',
	priority: 10,
	isContainer: false,

	tryStart(line, ctx) {
		if (!THEMATIC_RE.test(line)) return null;
		/** @type {ThematicBreak} */
		const node = {
			type: 'thematic_break',
			range: mkRange(ctx.lineIndex, ctx.lineOffset, ctx.lineIndex, ctx.lineOffset + line.length),
			raw: line,
		};
		return { node };
	},

	tryContinue() {
		return null;
	},
};

// ── ATX heading ─────────────────────────────────────────────────────────────

/** @type {BlockRule} */
export const headingRule = {
	name: 'heading',
	priority: 20,
	isContainer: false,

	tryStart(line, ctx) {
		const m = line.match(HEADING_RE);
		if (!m) return null;
		const level = m[1].length;
		const text = m[2];
		const chunk = { text, line: ctx.lineIndex, offset: ctx.lineOffset + level };
		/** @type {Heading} */
		const node = {
			type: 'heading',
			level,
			range: mkRange(ctx.lineIndex, ctx.lineOffset, ctx.lineIndex, ctx.lineOffset + line.length),
			children: [],
			raw: line,
			chunks: [chunk],
		};
		return { node };
	},

	tryContinue() {
		return null;
	},
	// _raw is cleaned up by the inline pass after tokenization.
};

// ── Fenced code block ────────────────────────────────────────────────────────

/** @type {BlockRule} */
export const codeBlockRule = {
	name: 'code_block',
	priority: 30,
	isContainer: false,

	tryStart(line, ctx) {
		const m = line.match(FENCE_OPEN_RE);
		if (!m) return null;
		const fenceStr = m[2]; // full fence string e.g. "```"
		const fenceChar = m[3] ? '`' : '~';
		const lang = m[6].trim();
		if (fenceChar == '`' && lang.includes('`')) return null;
		/** @type {CodeBlock & { _fenceLen: number }} */
		const node = {
			type: 'code_block',
			lang,
			fenceChar,
			value: '',
			range: mkRange(ctx.lineIndex, ctx.lineOffset, ctx.lineIndex, ctx.lineOffset + line.length),
			raw: line,
			_fenceLen: fenceStr.length,
		};
		return { node };
	},

	tryContinue(line, node, ctx) {
		const n = /** @type {CodeBlock & { _fenceLen: number }} */ (node);
		const closeMatch = line.match(FENCE_CLOSE_RE);
		if (closeMatch) {
			const closer = closeMatch[1].trimStart();
			if (closer[0] == n.fenceChar && closer.length >= n._fenceLen) {
				// Closing fence found — consume and signal close.
				n.range = { ...n.range, end: mkPos(ctx.lineIndex, ctx.lineOffset + line.length) };
				return { remainder: '', remainderOffset: ctx.lineOffset, close: true };
			}
		}
		n.value += (n.value ? '\n' : '') + line;
		n.range = { ...n.range, end: mkPos(ctx.lineIndex, ctx.lineOffset + line.length) };
		return { remainder: line, remainderOffset: ctx.lineOffset };
	},

	finalize(node) {
		delete (/** @type {any} */ (node)._fenceLen);
	},
};

// ── Blockquote ───────────────────────────────────────────────────────────────

/** @type {BlockRule} */
export const blockquoteRule = {
	name: 'blockquote',
	priority: 40,
	isContainer: true,

	tryStart(line, ctx) {
		if (!BLOCKQUOTE_RE.test(line)) return null;
		const stripped = line.replace(/^[ \t]{0,3}>[ \t]?/, '');
		const consumed = line.length - stripped.length;
		/** @type {Blockquote} */
		const node = {
			type: 'blockquote',
			range: mkRange(ctx.lineIndex, ctx.lineOffset, ctx.lineIndex, ctx.lineOffset + line.length),
			raw: line,
			children: [],
		};
		return { node, remainder: stripped, remainderOffset: ctx.lineOffset + consumed };
	},

	tryContinue(line, node, ctx) {
		if (!BLOCKQUOTE_RE.test(line)) return null;
		const stripped = line.replace(/^[ \t]{0,3}>[ \t]?/, '');
		const consumed = line.length - stripped.length;
		node.range = { ...node.range, end: mkPos(ctx.lineIndex, ctx.lineOffset + line.length) };
		return { remainder: stripped, remainderOffset: ctx.lineOffset + consumed };
	},
};

// ── List item ────────────────────────────────────────────────────────────────

/** @type {BlockRule} */
export const listItemRule = {
	name: 'list_item',
	priority: 50,
	isContainer: true,

	tryStart(line, ctx) {
		const ul = line.match(UL_RE);
		// ol assumed to be valid if ul is not
		const ol = /** @type {typeof ul extends RegExpMatchArray ? null : RegExpMatchArray} */ (
			line.match(OL_RE)
		);
		if (!ul && !ol) return null;
		const marker = ul ? ul[2] : `${ol[2]}${ol[3]}`;
		const indent = ul ? ul[1].length : ol[1].length;
		const remainder = ul ? ul[3] : ol[4];
		const contentIndent = indent + marker.length + 1;
		/** @type {ListItem & { _indent: number, _contentIndent: number }} */
		const node = {
			type: 'list_item',
			marker,
			range: mkRange(ctx.lineIndex, ctx.lineOffset, ctx.lineIndex, ctx.lineOffset + line.length),
			raw: line,
			children: [],
			_indent: indent,
			_contentIndent: contentIndent,
		};
		return { node, remainder, remainderOffset: ctx.lineOffset + contentIndent };
	},

	tryContinue(line, node, ctx) {
		const item = /** @type {ListItem & { _contentIndent: number, _hadBlank?: boolean }} */ (node);
		if (BLANK_RE.test(line)) {
			item._hadBlank = true;
			return { remainder: '', remainderOffset: ctx.lineOffset };
		}
		const leadingSpaces = (line.match(/^([ \t]*)/)?.[1] ?? '').length;
		if (leadingSpaces >= item._contentIndent) {
			const remainder = line.slice(item._contentIndent);
			item.range = { ...item.range, end: mkPos(ctx.lineIndex, ctx.lineOffset + line.length) };
			return { remainder, remainderOffset: ctx.lineOffset + item._contentIndent };
		}
		return null;
	},

	finalize(node) {
		const n = /** @type {any} */ (node);
		delete n._indent;
		delete n._contentIndent;
		// _hadBlank is cleaned up by the List rule's finalize.
	},
};

// ── Paragraph ────────────────────────────────────────────────────────────────

/** @type {BlockRule} */
export const paragraphRule = {
	name: 'paragraph',
	priority: 999,
	isContainer: false,

	tryStart(line, ctx) {
		if (BLANK_RE.test(line)) return null;
		/** @type {Paragraph} */
		const node = {
			type: 'paragraph',
			range: mkRange(ctx.lineIndex, ctx.lineOffset, ctx.lineIndex, ctx.lineOffset + line.length),
			raw: line,
			children: [],
			chunks: [{ text: line, line: ctx.lineIndex, offset: ctx.lineOffset }],
		};
		return { node };
	},

	tryContinue(line, node, ctx) {
		// Only continue if no other blocks can consume
		if (!ctx.rules.every((rule) => rule.name == 'paragraph' || !rule.tryStart(line, ctx)))
			return null;
		const p = /** @type {Paragraph} */ (node);
		p.chunks.push({ text: line, line: ctx.lineIndex, offset: ctx.lineOffset });
		p.range = { ...p.range, end: mkPos(ctx.lineIndex, ctx.lineOffset + line.length) };
		return { remainder: line, remainderOffset: ctx.lineOffset };
	},
};

// ---------------------------------------------------------------------------
// Compiled rule set
// ---------------------------------------------------------------------------

const BUILT_IN_RULES = [
	thematicBreakRule,
	headingRule,
	codeBlockRule,
	blockquoteRule,
	listItemRule,
	paragraphRule,
];

/**
 * @param {BlockParserOptions} [options]
 * @returns {BlockRule[]}
 */
const compileRules = (options = {}) => {
	const disabled = new Set(options.disableRules ?? []);
	const custom = options.rules ?? [];
	return [...BUILT_IN_RULES.filter((r) => !disabled.has(r.name)), ...custom].sort(
		(a, b) => (a.priority ?? 50) - (b.priority ?? 50),
	);
};

// ---------------------------------------------------------------------------
// List wrapper
// ---------------------------------------------------------------------------

/**
 * Determine whether two list item markers are compatible (belong to the same list).
 * @param {string} a @param {string} b @returns {boolean}
 */
const markersCompatible = (a, b) => {
	const aOrd = /\d/.test(a),
		bOrd = /\d/.test(b);
	if (aOrd != bOrd) return false;
	return aOrd ? a.slice(-1) == b.slice(-1) : a == b;
};

/**
 * The virtual rule for a List node (no line marker; opens/closes implicitly).
 * @returns {BlockRule}
 */
const makeListRule = () => ({
	name: 'list',
	isContainer: true,
	tryStart: () => null,
	// Pass the line through unchanged — List has no marker of its own.
	tryContinue: (line, node, ctx) => {
		// Blank lines between items are allowed.
		if (BLANK_RE.test(line)) return { remainder: line, remainderOffset: ctx.lineOffset };

		const list = /** @type {List & { _lastContentIndent?: number }} */ (node);

		// A new compatible list item continues the list.
		const ul = line.match(UL_RE);
		const ol = /** @type {typeof ul extends RegExpMatchArray ? null : RegExpMatchArray} */ (
			line.match(OL_RE)
		);
		if (ul || ol) {
			const marker = ul ? ul[2] : `${ol[2]}${ol[3]}`;
			if (markersCompatible(list.children.at(-1)?.marker ?? '', marker)) {
				return { remainder: line, remainderOffset: ctx.lineOffset };
			}
		}

		// A line indented enough to continue the last item's content.
		if (typeof list._lastContentIndent == 'number') {
			const leading = (line.match(/^([ \t]*)/)?.[1] ?? '').length;
			if (leading >= list._lastContentIndent) {
				return { remainder: line, remainderOffset: ctx.lineOffset };
			}
		}

		// Nothing matched — the list should close.
		return null;
	},
	finalize(node) {
		const list = /** @type {List & { _lastContentIndent?: number }} */ (node);
		list.tight = !list.children.some((item) => /** @type {any} */ (item)._hadBlank);
		for (const item of list.children) delete (/** @type {any} */ (item)._hadBlank);
		delete list._lastContentIndent;
	},
});

/**
 * Wrap a new ListItem in the appropriate List node.
 * Appends to an existing compatible List at the top of the stack, or creates a new one.
 *
 * @param {StackEntry[]}    stack
 * @param {ListItem}        itemNode
 * @param {BlockRuleContext} ctx
 */
const wrapInList = (stack, itemNode, ctx) => {
	const parentEntry = stack[stack.length - 1];
	const parentNode = parentEntry.node;

	if (
		parentNode.type == 'list' &&
		markersCompatible(
			/** @type {List} */ (parentNode).children.at(-1)?.marker ?? '',
			itemNode.marker,
		)
	) {
		// Compatible list already open — just append the item.
		const list = /** @type {List} */ (parentNode);
		list.children.push(itemNode);
		list.range = { ...list.range, end: itemNode.range.end };
		return;
	}

	// Start a new List.
	const isOrdered = /\d/.test(itemNode.marker);
	/** @type {List} */
	const listNode = {
		type: 'list',
		ordered: isOrdered,
		start: isOrdered ? parseInt(itemNode.marker, 10) : 1,
		tight: true,
		range: { ...itemNode.range },
		raw: itemNode.raw,
		children: [itemNode],
	};
	// Attach to current innermost container.
	if ('children' in parentNode && Array.isArray(parentNode.children)) {
		/** @type {any} */ (parentNode).children.push(listNode);
	}
	stack.push(entry(listNode, makeListRule(), ctx.lineIndex, ctx.lineOffset));
};

// ---------------------------------------------------------------------------
// Open-block stack entry type
// ---------------------------------------------------------------------------

/**
 * @typedef {{ node: BlockNode, rule: BlockRule, startLine: number, startOffset: number }} StackEntry
 */

/** @param {BlockNode} n @param {BlockRule} r @param {number} sl @param {number} so @returns {StackEntry} */
const entry = (n, r, sl, so) => ({ node: n, rule: r, startLine: sl, startOffset: so });

// ---------------------------------------------------------------------------
// Core parse loop
// ---------------------------------------------------------------------------

/** Sentinel rule for the document root — always continues. @type {BlockRule} */
const documentRule = {
	name: 'document',
	isContainer: true,
	tryStart: () => null,
	tryContinue: (line, _n, ctx) => ({ remainder: line, remainderOffset: ctx.lineOffset }),
};

/**
 * @param {string}      source
 * @param {BlockRule[]} rules
 * @returns {Document}
 */
const parseBlockTree = (source, rules) => {
	const lines = source.split('\n');
	let offset = 0;

	/** @type {Document} */
	const root = { type: 'document', range: mkRange(0, 0, 0, 0), raw: source, children: [] };

	/** @type {StackEntry[]} */
	const stack = [entry(root, documentRule, 0, 0)];

	/** @param {BlockNode} node */
	const appendChild = (node) => {
		const top = stack[stack.length - 1].node;
		if ('children' in top && Array.isArray(top.children))
			/** @type {any} */ (top).children.push(node);
	};

	/** Close (pop+finalize) stack entries from `fromIndex` to top. @param {number} from */
	const closeBlocks = (from) => {
		while (stack.length > from) {
			const e = stack.pop();
			e?.rule.finalize?.(e.node);
		}
	};

	lineLoop: for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const rawLine = lines[lineIndex];
		let line = rawLine;
		let lineOff = 0;
		let lastContinued = 0;
		let lazyContinued = false;

		// ── Phase 1: try to continue each open block ──────────────────────────
		for (let i = 1; i < stack.length; i++) {
			const e = stack[i];
			const ctx = { lines, lineIndex, lineOffset: offset + lineOff, rules };

			// Code block: handles close internally via result.close.
			if (e.node.type == 'code_block') {
				const result = e.rule.tryContinue(line, e.node, ctx);
				if (result != null) {
					lastContinued = i;
					if (result.close) {
						closeBlocks(i); // pop the code_block and finalize it
						offset += rawLine.length + 1;
						continue lineLoop; // line fully consumed
					}
				}
				break; // code_block is always the deepest leaf
			}

			const result = e.rule.tryContinue(line, e.node, ctx);
			if (result != null) {
				line = result.remainder;
				lineOff = result.remainderOffset - offset;
				lastContinued = i;
			} else {
				// Lazy continuation: if innermost open leaf is a paragraph and the
				// line cannot interrupt it, extend the paragraph without markers.
				const leaf = stack[stack.length - 1].node;
				if (
					leaf.type == 'paragraph' &&
					rules.every((rule) => rule.name == 'paragraph' || !rule.tryStart(line, ctx))
				) {
					const p = /** @type {Paragraph} */ (leaf);
					p.chunks.push({ text: rawLine, line: lineIndex, offset: offset });
					p.range = { ...p.range, end: mkPos(lineIndex, offset + rawLine.length) };
					lastContinued = stack.length - 1;
					lazyContinued = true;
				}
				break;
			}
		}

		// ── Phase 2: close uncontinued blocks ─────────────────────────────────
		closeBlocks(lastContinued + 1);

		// Lazy continuation consumed this line fully — no block-start detection.
		if (lazyContinued) {
			offset += rawLine.length + 1;
			continue;
		}

		// Blank lines after continuation — update offset and skip Phase 3.
		if (BLANK_RE.test(line)) {
			offset += rawLine.length + 1;
			continue;
		}

		// ── Phase 3: open new blocks ───────────────────────────────────────────
		// Iterate until we open a leaf block (leaves don't nest further blocks).
		let openedContainer = true;
		while (openedContainer && !BLANK_RE.test(line)) {
			openedContainer = false;
			const ctx = { lines, lineIndex, lineOffset: offset + lineOff, rules };

			for (const rule of rules) {
				const result = rule.tryStart(line, ctx);
				if (result == null) continue;

				const { node, remainder, remainderOffset } = result;

				if (node.type == 'list_item') {
					wrapInList(stack, /** @type {ListItem} */ (node), ctx);
					stack.push(entry(node, rule, lineIndex, offset + lineOff));
				} else if (rule.isContainer) {
					appendChild(node);
					stack.push(entry(node, rule, lineIndex, offset + lineOff));
				} else {
					appendChild(node);
					// Single-line leaves (thematic_break, heading) don't go on the stack.
					// Multi-line leaves (paragraph, code_block) do.
					if (node.type != 'thematic_break' && node.type != 'heading') {
						stack.push(entry(node, rule, lineIndex, offset + lineOff));
					}
				}

				if (rule.isContainer && remainder != undefined) {
					line = remainder;
					lineOff = (remainderOffset ?? 0) - offset;
					openedContainer = true;
				}
				break; // one rule per iteration
			}
		}

		offset += rawLine.length + 1;
	}

	// ── Close all remaining open blocks ───────────────────────────────────
	closeBlocks(1);
	root.range = mkRange(0, 0, Math.max(0, lines.length - 1), source.length);
	return root;
};

// ---------------------------------------------------------------------------
// Line number adjustment (for incremental updates)
// ---------------------------------------------------------------------------

/**
 * Walk an entire subtree and shift every `range` by `deltaLines` lines and
 * `deltaOffset` bytes. Used after an incremental edit to update the "after"
 * blocks' source positions.
 *
 * @param {BlockNode} node
 * @param {number}    deltaLines
 * @param {number}    deltaOffset
 */
export const shiftRanges = (node, deltaLines, deltaOffset) => {
	const shift = (/** @type {NodeRange}} */ r) => ({
		start: mkPos(r.start.line + deltaLines, r.start.offset + deltaOffset),
		end: mkPos(r.end.line + deltaLines, r.end.offset + deltaOffset),
	});

	node.range = shift(node.range);

	if (isParentBlock(node)) {
		for (const child of node.children) {
			if (typeof child.range.start == 'number' && typeof child.range.end == 'number') continue;
			shiftRanges(/** @type {BlockNode} */ (child), deltaLines, deltaOffset);
		}
	}
};

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * @param {BlockParserOptions} [options]
 * @returns {{ parseBlocks: (source: string) => Document }}
 */
export const createBlockParser = (options = {}) => {
	const rules = compileRules(options);
	return {
		/** @param {string} source @returns {Document} */
		parseBlocks(source) {
			return parseBlockTree(source, rules);
		},
	};
};

export const defaultBlockParser = createBlockParser();

/** @param {string} source @returns {Document} */
export const parseBlocks = (source) => defaultBlockParser.parseBlocks(source);
