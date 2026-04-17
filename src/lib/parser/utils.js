// parser/utils.js

/**
 * Utility functions for working with the markdown AST.
 *
 * All functions are pure — they do not mutate nodes.
 *
 * @module utils
 */

/**
 * @import {
 *   AnyNode, BlockNode, InlineNode, Document, Paragraph, Heading,
 *   ListItem, CodeBlock, Bold, Italic, Strike, LinkNode, ParentBlock, ParentInline
 * } from './types';
 */

// ---------------------------------------------------------------------------
// Type Guards (The magic that removes `any` casts)
// ---------------------------------------------------------------------------

/**
 * Determines if a node is a Block Parent (safely exposing .children)
 * @template {AnyNode} [ChildNode=AnyNode]
 * @param {AnyNode} node
 * @returns {node is ParentBlock<ChildNode>}
 */
export const isParentBlock = (node) => {
	return 'children' in node && Array.isArray(node.children);
};

/**
 * Determines if a node is an Inline Parent (safely exposing .children)
 * @param {AnyNode} node
 * @returns {node is ParentInline}
 */
export const isParentInline = (node) => {
	return 'children' in node && Array.isArray(node.children);
};

// ---------------------------------------------------------------------------
// walk — depth-first tree traversal
// ---------------------------------------------------------------------------

/**
 * @callback BlockVisitor
 * @param {BlockNode} node
 * @param {BlockNode | null} parent
 * @param {number} depth
 * @returns {boolean | void}
 */

/**
 * @param {BlockNode} root
 * @param {BlockVisitor} visitor
 */
export const walk = (root, visitor) => {
	walkNode(root, null, 0, visitor);
};

/**
 * @param {BlockNode} node
 * @param {BlockNode | null} parent
 * @param {number} depth
 * @param {BlockVisitor} visitor
 */
const walkNode = (node, parent, depth, visitor) => {
	const descend = visitor(node, parent, depth);
	if (descend == false) return;

	// No casting needed! TS knows `node` is a ParentBlock here.
	if (isParentBlock(node)) {
		for (const child of node.children) {
			// Ensure we are only walking BlockNodes, not InlineNodes
			if (child.type != 'text' && child.type != 'bold' /* etc... or better, use a guard */) {
				// @ts-expect-error - for dynamic ASTs, TS sometimes still worries about custom nodes
				walkNode(child, node, depth + 1, visitor);
			}
		}
	}
};

/**
 * @callback InlineVisitor
 * @param {InlineNode} node
 * @param {InlineNode | null} parent
 * @param {number} depth
 * @returns {boolean | void}
 */

/**
 * Walk an inline node tree depth-first.
 *
 * @param {InlineNode}   root
 * @param {InlineVisitor} visitor
 */
export const walkInline = (root, visitor) => {
	walkInlineNode(root, null, 0, visitor);
};

/**
 * @param {InlineNode}   node
 * @param {InlineNode | null} parent
 * @param {number}       depth
 * @param {InlineVisitor} visitor
 */
const walkInlineNode = (node, parent, depth, visitor) => {
	const descend = visitor(node, parent, depth);
	if (descend == false) return;
	if ('children' in node && Array.isArray(node.children)) {
		for (const child of /** @type {any} */ (node).children) {
			walkInlineNode(child, node, depth + 1, visitor);
		}
	}
};

// ---------------------------------------------------------------------------
// find — locate a block node by predicate
// ---------------------------------------------------------------------------

/**
 * Return the first block node (depth-first) matching `predicate`, or `null`.
 *
 * @param {BlockNode}               root
 * @param {(node: BlockNode) => boolean} predicate
 * @returns {BlockNode | null}
 */
export const find = (root, predicate) => {
	/** @type {BlockNode | null} */
	let found = null;
	walk(root, (node) => {
		if (found) return false;
		if (predicate(node)) {
			found = node;
			return false;
		}
	});
	return found;
};

// ---------------------------------------------------------------------------
// findBlockAt — locate block node containing a source line
// ---------------------------------------------------------------------------

/**
 * Return the deepest block node whose source range contains `line`.
 * Returns `null` if the document is empty or the line is out of range.
 *
 * @param {Document} doc
 * @param {number}   line  0-based line number
 * @returns {BlockNode | null}
 */
export const findBlockAt = (doc, line) => {
	/** @type {BlockNode | null} */
	let best = null;
	walk(doc, (node) => {
		if (!node.range) return;
		const { start, end } = node.range;
		if (start.line <= line && line <= end.line) {
			// This node covers the line. Record it (later visits are deeper).
			best = node;
		} else {
			// If this node's range doesn't cover the line, skip its children.
			return false;
		}
	});
	return best;
};

// ---------------------------------------------------------------------------
// findInlineAt — locate inline node containing a content offset
// ---------------------------------------------------------------------------

/**
 * Return the deepest inline node whose range contains `offset`.
 * `offset` is a byte offset within the leaf node's inline content string
 * (`paragraph.rawLines.join('\n')` or the heading's raw text).
 *
 * @param {InlineNode[]} nodes   The top-level inline nodes from a leaf block.
 * @param {number}       offset  Byte offset within the inline content.
 * @returns {InlineNode | null}
 */
export const findInlineAt = (nodes, offset) => {
	for (const node of nodes) {
		const result = findInlineNodeAt(node, offset);
		if (result) return result;
	}
	return null;
};

/**
 * @param {InlineNode} node
 * @param {number}     offset
 * @returns {InlineNode | null}
 */
const findInlineNodeAt = (node, offset) => {
	const r = node.range;
	if (!r || offset < r.start.offset || offset >= r.end.offset) return null;
	// Check children for a deeper match.
	if ('children' in node && Array.isArray(node.children)) {
		for (const child of /** @type {any} */ (node).children) {
			const deeper = findInlineNodeAt(child, offset);
			if (deeper) return deeper;
		}
	}
	return node;
};

// ---------------------------------------------------------------------------
// serialize — AST → markdown string
// ---------------------------------------------------------------------------

/**
 * Serialize a block node back to a markdown string.
 * The output is valid CommonMark markdown that round-trips through the parser.
 *
 * @param {BlockNode} node
 * @param {object}    [opts]
 * @param {string}    [opts.indent]  Leading indent prefix (used internally for containers).
 * @returns {string}
 */
export const serialize = (node, opts = {}) => {
	const indent = opts.indent ?? '';
	return serializeBlock(node, indent);
};

/**
 * @param {BlockNode} node
 * @param {string}    indent
 * @returns {string}
 */
const serializeBlock = (node, indent) => {
	switch (node.type) {
		case 'document':
			return node.children?.map((c) => serializeBlock(c, indent)).join('\n\n') ?? '';

		case 'blank_line':
			return '';

		case 'blockquote': {
			if (!node.children) return '';
			const inner = node.children.map((c) => serializeBlock(c, '')).join('\n\n');
			// Prefix every line with `> `.
			return inner
				.split('\n')
				.map((line) => `${indent}> ${line}`)
				.join('\n');
		}

		case 'list': {
			const sep = node.tight ? '\n' : '\n\n';
			return (
				node.children
					?.map((item) => {
						return serializeListItem(/** @type {ListItem} */ (item), indent);
					})
					.join(sep) ?? ''
			);
		}

		case 'list_item': {
			const listItem = /** @type {ListItem} */ (node);
			// Serialized via serializeListItem; shouldn't be called directly.
			return serializeListItem(listItem, indent);
		}
		case 'heading': {
			const heading = /** @type {Heading} */ (node);
			return `${indent}${'#'.repeat(heading.level)} ${serializeInlines(heading.children)}`;
		}

		case 'paragraph': {
			const paragraph = /** @type {Paragraph} */ (node);
			const lines = paragraph.chunks?.map((c) => c.text) ?? [serializeInlines(paragraph.children)];
			return lines.map((l) => `${indent}${l}`).join('\n');
		}

		case 'code_block': {
			const codeBlock = /** @type {CodeBlock} */ (node);
			const fence = codeBlock.fenceChar?.repeat(3) ?? '';
			const lines = [
				`${indent}${fence}${codeBlock.lang}`,
				...codeBlock.value.split('\n').map((l) => `${indent}${l}`),
				`${indent}${fence}`,
			];
			return lines.join('\n');
		}

		case 'thematic_break':
			return `${indent}---`;

		default:
			// Custom block node — best-effort: serialize children if present.
			if (isParentBlock(node)) {
				return node.children
					.filter(
						/**
						 * @param c
						 * @returns {c is BlockNode}
						 */
						(c) => typeof c.range.start == 'object' && typeof c.range.end == 'object',
					)
					.map((c) => serializeBlock(c, indent))
					.join('\n\n');
			}
			return '';
	}
};

/**
 * @param {ListItem} item
 * @param {string}   indent
 * @returns {string}
 */
const serializeListItem = (item, indent) => {
	const marker = item.marker + ' ';
	const childIndent = indent + ' '.repeat(marker.length);
	const children = item.children.map((c, i) =>
		i == 0 ? serializeBlock(c, '') : serializeBlock(c, childIndent),
	);
	const body = children.join('\n\n');
	// Prefix the first line with the marker, continuation lines with childIndent.
	const lines = body.split('\n');
	return lines
		.map((line, i) => (i == 0 ? `${indent}${marker}${line}` : `${childIndent}${line}`))
		.join('\n');
};

/**
 * @param {InlineNode[]} nodes
 * @returns {string}
 */
const serializeInlines = (nodes) => nodes.map(serializeInline).join('');

/**
 * @param {InlineNode} node
 * @returns {string}
 */
const serializeInline = (node) => {
	switch (node.type) {
		case 'text':
			return /** @type {string} */ (node.value);
		case 'soft_break':
			return '\n';
		case 'bold':
			return `**${serializeInlines(/** @type {Bold} */ (node).children)}**`;
		case 'italic':
			return `*${serializeInlines(/** @type {Italic} */ (node).children)}*`;
		case 'inline_code':
			return `\`${node.value}\``;
		case 'strike':
			return `~~${serializeInlines(/** @type {Strike} */ (node).children)}~~`;
		case 'link':
			return `[${serializeInlines(/** @type {LinkNode} */ (node).children)}](${node.href})`;
		case 'image':
			return `![${node.alt}](${node.href})`;
		case 'escape':
			return `\\${node.char}`;
		default:
			return isParentInline(node) ? serializeInlines(node.children) : '';
	}
};
