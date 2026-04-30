/**
 * @import { AnyNode } from '$lib/parser';
 */

import { findNodeById } from '$lib/parser/utils';

/**
 * @typedef {Object} RawSelection
 * @property {number} anchor
 * @property {number} focus
 * @property {boolean} isCollapsed
 */

/**
 * Translates a DOM Selection into absolute offsets in the source string.
 * @param {Element} editorEl
 * @param {AnyNode} doc
 * @returns {RawSelection | null}
 */
export function captureSelection(editorEl, doc) {
	const sel = window.getSelection();
	if (!(sel && sel.anchorNode && editorEl.contains(sel.anchorNode))) return null;

	/** @param {Node} domNode @param {number} domOffset */
	const getOffset = (domNode, domOffset) => {
		const el =
			domNode.nodeType == Node.ELEMENT_NODE
				? /** @type {Element} */ (domNode)
				: domNode.parentElement;
		const container = el?.closest('[data-md-id]');
		if (!container) return 0;

		const astNode = findNodeById(doc, container.getAttribute('data-md-id') ?? '');

		// Fallback if ID is missing (shouldn't happen with our updated Token.svelte)
		if (!astNode) {
			return Number.parseInt(container.getAttribute('data-md-start-offset') || '0', 10);
		}

		// Check for an explicit override (useful if you ever have custom leaf nodes that hide syntax)
		const attrOffset = container.getAttribute('data-md-content-offset');
		let baseOffset;

		if (attrOffset != null) {
			baseOffset = Number.parseInt(attrOffset, 10);
		} else if (astNode.children) {
			// Parent nodes: content starts at the first child, or the end of the node if it's empty.
			baseOffset = astNode.children.length
				? astNode.children[0].range.start.offset
				: astNode.range.end.offset;
		} else {
			// Leaf nodes map 1:1 from their start offset.
			baseOffset = astNode.range.start.offset;
		}

		if (domNode.nodeType == Node.TEXT_NODE) {
			let textOffset = 0;
			const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
			while (walker.nextNode()) {
				if (walker.currentNode == domNode) break;
				textOffset += walker.currentNode.textContent?.length ?? 0;
			}
			return baseOffset + textOffset + domOffset;
		} else {
			let current = 0;
			for (let i = 0; i < domOffset && i < domNode.childNodes.length; i++) {
				let n = domNode.childNodes[i];
				if (n instanceof Comment) continue;
				current += n.textContent?.length ?? 0;
			}
			return baseOffset + current;
		}
	};

	const anchor = getOffset(sel.anchorNode, sel.anchorOffset);
	const focus = sel.focusNode ? getOffset(sel.focusNode, sel.focusOffset) : anchor;
	return {
		anchor,
		focus,
		isCollapsed: sel.isCollapsed,
	};
}

/**
 * Translates source offsets back into a DOM Selection.
 * @param {Element} editorEl
 * @param {RawSelection} selection
 * @param {AnyNode} doc
 */
export function restoreSelection(editorEl, selection, doc) {
	const domSel = window.getSelection();
	if (!domSel || !selection) return;

	const resolve = (/** @type {number} */ targetOffset) => {
		const node = findDeepestNodeAtOffset(doc, targetOffset);
		if (!node) return null;

		// 1. Query strictly by the AST node's unique ID
		const el = editorEl.querySelector(`[data-md-id="${node.id}"]`);
		if (!el) return null;

		// 2. Resolve structural base offset dynamically
		const attrOffset = el.getAttribute('data-md-content-offset');
		let domBase;

		if (attrOffset != null) {
			domBase = Number.parseInt(attrOffset, 10);
		} else if (node.children) {
			domBase = node.children.length ? node.children[0].range.start.offset : node.range.end.offset;
		} else {
			domBase = node.range.start.offset;
		}

		const localTarget = targetOffset - domBase;
		let current = 0;
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);

		while (walker.nextNode()) {
			const len = walker.currentNode.textContent?.length ?? 0;
			if (current + len >= localTarget) {
				return { node: walker.currentNode, offset: localTarget - current };
			}
			current += len;
		}
		
		const fallbackWalker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		/** @type {Node | null} */
		let lastTextNode = null;
		while (fallbackWalker.nextNode()) lastTextNode = fallbackWalker.currentNode;
		if (lastTextNode) {
			return { node: lastTextNode, offset: lastTextNode.textContent?.length ?? 0 };
		}
		return { node: el, offset: 0 };
	};

	const anchor = resolve(selection.anchor);
	const focus = selection.isCollapsed ? anchor : resolve(selection.focus);

	if (anchor) {
		const range = document.createRange();
		range.setStart(anchor.node, anchor.offset);
		if (selection.isCollapsed) {
			range.collapse(true);
		} else if (focus) {
			range.setEnd(focus.node, focus.offset);
		}
		domSel.removeAllRanges();
		domSel.addRange(range);
	}
}

/**
 * Helper: Search the AST tree for the narrowest node containing the offset
 * @param {AnyNode} node
 * @param {number} offset
 */
function findDeepestNodeAtOffset(node, offset) {
	if (node.children) {
		// Pass 1: strict half-open interval [start, end)
		for (const child of node.children) {
			const { start, end } = child.range;
			if (offset >= start.offset && offset < end.offset) {
				return findDeepestNodeAtOffset(child, offset);
			}
		}
		// Pass 2: exact end-boundary match (cursor at trailing edge of last content)
		for (const child of node.children) {
			if (offset == child.range.end.offset) {
				return findDeepestNodeAtOffset(child, offset);
			}
		}
	}
	return node;
}
