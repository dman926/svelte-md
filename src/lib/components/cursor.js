/**
 * @import { AnyNode } from '$lib/parser';
 */

/**
 * @typedef {Object} RawSelection
 * @property {number} anchor
 * @property {number} focus
 * @property {boolean} isCollapsed
 */

/**
 * Translates a DOM Selection into absolute offsets in the source string.
 * @param {Element} editorEl
 * @returns {RawSelection | null}
 */
export function captureSelection(editorEl) {
	const sel = window.getSelection();
	if (!(sel && sel.anchorNode && editorEl.contains(sel.anchorNode))) return null;

	/** @param {Node} node @param {number} domOffset */
	const getOffset = (node, domOffset) => {
		// 1. Get the nearest element to the node
		const el =
			node.nodeType == Node.ELEMENT_NODE ? /** @type {Element} */ (node) : node.parentElement;

		// 2. Find the closest element that has our offset metadata
		const container = el?.closest('[data-md-start-offset]');
		if (!container) return 0;

		const baseOffset = parseInt(container.getAttribute('data-md-start-offset') || '0', 10);

		// 3. If the selection is on the element itself (e.g., between spans),
		// the domOffset is the index of the child node.
		if (node.nodeType == Node.ELEMENT_NODE) {
			let current = 0;
			for (let i = 0; i < domOffset && i < node.childNodes.length; i++) {
				current += node.childNodes[i].textContent?.length ?? 0;
			}
			return baseOffset + current;
		}

		// 4. If the selection is in a text node, sum up preceding text in the container
		let textOffset = 0;
		const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
		while (walker.nextNode()) {
			if (walker.currentNode == node) break;
			textOffset += walker.currentNode.textContent?.length ?? 0;
		}

		return baseOffset + textOffset + domOffset;
	};

	const anchor = getOffset(sel.anchorNode, sel.anchorOffset);
	return {
		anchor,
		focus: sel.focusNode ? getOffset(sel.focusNode, sel.focusOffset) : anchor,
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
		// 1. Find the deepest node in the AST containing this offset
		const node = findDeepestNodeAtOffset(doc, targetOffset);
		if (!node) return null;

		// 2. Find the DOM element for that node
		const el = editorEl.querySelector(`[data-md-start-offset="${node.range.start.offset}"]`);
		if (!el) return null;

		// 3. Map the remaining offset to a text node inside that element
		const localTarget = targetOffset - node.range.start.offset;
		let current = 0;
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);

		while (walker.nextNode()) {
			const len = walker.currentNode.textContent?.length ?? 0;
			if (current <= localTarget && localTarget <= current + len) {
				return { node: walker.currentNode, offset: localTarget - current };
			}
			current += len;
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
		for (const child of node.children) {
			if (offset >= child.range.start.offset && offset <= child.range.end.offset) {
				return findDeepestNodeAtOffset(child, offset);
			}
		}
	}
	return node;
}
