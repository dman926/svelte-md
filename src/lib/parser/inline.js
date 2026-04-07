/**
 * Inline tokenizer — Phase 2 of the parse pipeline.
 *
 * Walks the block tree produced by `block.js` and populates `children` on
 * every leaf node with InlineNode objects. CodeBlock nodes are left as-is
 * (their `value` is raw text for the renderer to highlight).
 *
 * ## Source positions on inline nodes
 *
 * Every InlineNode carries a `range: InlineRange` whose `start` and `end` are
 * byte offsets within the leaf node's inline content string:
 *   - Paragraph: `rawLines.join('\n')`
 *   - Heading:   the `_raw` string set by headingRule.tryStart
 *
 * This lets an editor map a cursor position to the exact inline node without
 * additional traversal.
 *
 * ## Plugin system
 *
 * Custom inline rules implement `InlineRule` (see types.ts). They receive
 * `(raw, pos, end)` and must return `(InlineNode & { _end: number }) | null`.
 * The node MUST include a populated `range` field.
 */

/**
 * @import {
 *   BlockNode, Document, Heading, Paragraph,
 *   InlineNode, InlineParserOptions,
 * } from './types';
 */

// ---------------------------------------------------------------------------
// Scan helpers (pure)
// ---------------------------------------------------------------------------

/**
 * @param {string} str
 * @param {number} from
 * @param {string} delimChar
 * @param {number} len
 * @param {number} maxEnd
 * @returns {number}
 */
const findEmphasisClose = (str, from, delimChar, len, maxEnd) => {
	let i = from;
	while (i < maxEnd) {
		if (str[i] === delimChar) {
			let run = 0;
			while (i + run < maxEnd && str[i + run] === delimChar) run++;
			if (run === len) {
				if (delimChar === '_') {
					const after = str[i + run];
					if (after !== undefined && /\w/.test(after)) {
						i += run;
						continue;
					}
				}
				return i;
			}
			i += run;
		} else {
			i++;
		}
	}
	return -1;
};

/**
 * @param {string} str
 * @param {number} from
 * @param {number} len
 * @param {number} maxEnd
 * @returns {number}
 */
const findBacktickClose = (str, from, len, maxEnd) => {
	let i = from;
	while (i < maxEnd) {
		if (str[i] === '`') {
			let run = 0;
			while (i + run < maxEnd && str[i + run] === '`') run++;
			if (run === len) return i;
			i += run;
		} else {
			i++;
		}
	}
	return -1;
};

/**
 * @param {string} str
 * @param {number} from
 * @param {number} maxEnd
 * @returns {number}
 */
const findClosingBracket = (str, from, maxEnd) => {
	let depth = 1;
	for (let i = from; i < maxEnd; i++) {
		if (str[i] === '[') depth++;
		else if (str[i] === ']' && --depth === 0) return i;
	}
	return -1;
};

/**
 * @param {string} str
 * @param {number} from
 * @param {number} maxEnd
 * @returns {number}
 */
const findClosingParen = (str, from, maxEnd) => {
	let depth = 1;
	for (let i = from; i < maxEnd; i++) {
		if (str[i] === '(') depth++;
		else if (str[i] === ')' && --depth === 0) return i;
	}
	return -1;
};

// ---------------------------------------------------------------------------
// Compiled config
// ---------------------------------------------------------------------------

/** @param {InlineParserOptions} [options] */
const compileConfig = (options = {}) => {
	const disabled = new Set(options.disableRules ?? []);
	const customRules = (options.rules ?? [])
		.slice()
		.sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));
	return {
		escape: !disabled.has('escape'),
		code: !disabled.has('inline_code'),
		strike: !disabled.has('strike'),
		strikeD: '~~',
		bold: !disabled.has('bold'),
		italic: !disabled.has('italic'),
		link: !disabled.has('link'),
		image: !disabled.has('image'),
		softBreaks: options.softBreaks ?? 'space',
		customRules,
	};
};

// ---------------------------------------------------------------------------
// Core scanner
// ---------------------------------------------------------------------------

/**
 * @param {string} raw
 * @param {number} scanStart
 * @param {number} scanEnd
 * @param {ReturnType<typeof compileConfig>} cfg
 * @returns {InlineNode[]}
 */
const scan = (raw, scanStart, scanEnd, cfg) => {
	/** @type {InlineNode[]} */
	const nodes = [];
	let i = scanStart;
	let textBuf = '';
	let textStart = -1;

	const flushText = () => {
		if (textBuf) {
			nodes.push({ type: 'text', value: textBuf, range: { start: textStart, end: i } });
			textBuf = '';
			textStart = -1;
		}
	};
	const pushChar = (/** @type {string} */ ch) => {
		if (textStart < 0) textStart = i;
		textBuf += ch;
	};

	outer: while (i < scanEnd) {
		const ch = raw[i];

		// Custom rules
		for (const rule of cfg.customRules) {
			const result = rule.scan(raw, i, scanEnd);
			if (result !== null) {
				flushText();
				const { _end, ...node } = result;
				nodes.push(/** @type {InlineNode} */ (node));
				i = _end;
				continue outer;
			}
		}

		// Soft line break
		if (ch === '\n') {
			if (cfg.softBreaks === 'break') {
				flushText();
				nodes.push({ type: 'soft_break', range: { start: i, end: i + 1 } });
			} else {
				// Collapse the newline to a single space character.
				// Flush any pending text first so ranges stay accurate.
				flushText();
				nodes.push({ type: 'text', value: ' ', range: { start: i, end: i + 1 } });
			}
			i++;
			continue;
		}

		// Backslash escape
		if (cfg.escape && ch === '\\') {
			const next = raw[i + 1];
			if (next && /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(next)) {
				flushText();
				nodes.push({ type: 'escape', char: next, range: { start: i, end: i + 2 } });
				i += 2;
				continue;
			}
		}

		// Inline code
		if (cfg.code && ch === '`') {
			let tickLen = 0;
			while (i + tickLen < scanEnd && raw[i + tickLen] === '`') tickLen++;
			const closeIdx = findBacktickClose(raw, i + tickLen, tickLen, scanEnd);
			if (closeIdx !== -1) {
				flushText();
				let value = raw.slice(i + tickLen, closeIdx);
				if (value.length > 2 && value[0] === ' ' && value[value.length - 1] === ' ')
					value = value.slice(1, -1);
				nodes.push({ type: 'inline_code', value, range: { start: i, end: closeIdx + tickLen } });
				i = closeIdx + tickLen;
				continue;
			}
			pushChar(ch);
			i++;
			continue;
		}

		// Strikethrough
		if (cfg.strike && raw.startsWith(cfg.strikeD, i)) {
			const dLen = cfg.strikeD.length;
			const innerStart = i + dLen;
			const closeIdx = raw.indexOf(cfg.strikeD, innerStart);
			if (closeIdx !== -1 && closeIdx < scanEnd) {
				flushText();
				nodes.push({
					type: 'strike',
					children: scan(raw, innerStart, closeIdx, cfg),
					range: { start: i, end: closeIdx + dLen },
				});
				i = closeIdx + dLen;
				continue;
			}
		}

		// Bold / Italic
		if (ch === '*' || ch === '_') {
			const dc = ch;
			if (dc === '_') {
				const before = i > 0 ? raw[i - 1] : null;
				if (before !== null && /\w/.test(before)) {
					pushChar(ch);
					i++;
					continue;
				}
			}
			let openCount = 0;
			while (i + openCount < scanEnd && raw[i + openCount] === dc) openCount++;
			const excess = Math.max(0, openCount - 2);
			const len = Math.min(openCount, 2);
			const enabled = (len === 2 && cfg.bold) || (len === 1 && cfg.italic);
			const closeIdx = enabled ? findEmphasisClose(raw, i + openCount, dc, len, scanEnd) : -1;
			if (closeIdx !== -1) {
				flushText();
				const tokenStart = i + excess;
				const innerStart = tokenStart + len;
				if (excess > 0)
					nodes.push({
						type: 'text',
						value: dc.repeat(excess),
						range: { start: i, end: tokenStart },
					});
				nodes.push({
					type: len === 2 ? 'bold' : 'italic',
					children: scan(raw, innerStart, closeIdx, cfg),
					range: { start: tokenStart, end: closeIdx + len },
				});
				i = closeIdx + len;
				continue;
			}
			for (let k = 0; k < openCount; k++) pushChar(dc);
			i += openCount;
			continue;
		}

		// Image
		if (cfg.image && ch === '!' && raw[i + 1] === '[') {
			const bOpen = i + 2;
			const bClose = findClosingBracket(raw, bOpen, scanEnd);
			if (bClose !== -1 && raw[bClose + 1] === '(') {
				const pOpen = bClose + 2;
				const pClose = findClosingParen(raw, pOpen, scanEnd);
				if (pClose !== -1) {
					flushText();
					nodes.push({
						type: 'image',
						href: raw.slice(pOpen, pClose),
						alt: raw.slice(bOpen, bClose),
						range: { start: i, end: pClose + 1 },
					});
					i = pClose + 1;
					continue;
				}
			}
		}

		// Link
		if (cfg.link && ch === '[') {
			const bOpen = i + 1;
			const bClose = findClosingBracket(raw, bOpen, scanEnd);
			if (bClose !== -1 && raw[bClose + 1] === '(') {
				const pOpen = bClose + 2;
				const pClose = findClosingParen(raw, pOpen, scanEnd);
				if (pClose !== -1) {
					flushText();
					nodes.push({
						type: 'link',
						href: raw.slice(pOpen, pClose),
						children: scan(raw, bOpen, bClose, cfg),
						range: { start: i, end: pClose + 1 },
					});
					i = pClose + 1;
					continue;
				}
			}
		}

		pushChar(ch);
		i++;
	}

	flushText();
	return nodes;
};

// ---------------------------------------------------------------------------
// Block tree walker
// ---------------------------------------------------------------------------

/** @param {BlockNode} node @param {ReturnType<typeof compileConfig>} cfg */
const populate = (node, cfg) => {
	switch (node.type) {
		case 'document':
		case 'blockquote':
		case 'list_item':
			if (!node.children) break;
			for (const child of node.children) {
				populate(child, cfg);
			}
			break;
		case 'list':
			if (!node.children) break;
			for (const item of node.children) {
				populate(item, cfg);
			}
			break;
		case 'heading': {
			const h = /** @type {Heading & { _raw?: string }} */ (node);
			const raw = h._raw ?? '';
			h.children = scan(raw, 0, raw.length, cfg);
			delete h._raw;
			break;
		}
		case 'paragraph': {
			const p = /** @type {Paragraph} */ (node);
			const joined = p.rawLines.join('\n');
			p.children = scan(joined, 0, joined.length, cfg);
			break;
		}
		case 'code_block':
		case 'thematic_break':
			break;
		default:
			if ('children' in node && Array.isArray(node.children)) {
				for (const child of /** @type {any} */ (node).children) populate(child, cfg);
			}
	}
};

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/** @param {InlineParserOptions} [options] */
export const createInlineParser = (options = {}) => {
	const cfg = compileConfig(options);
	return {
		/** Walk the full block tree and populate inline children in-place. */
		populateInline(/** @type {Document} */ root) {
			populate(root, cfg);
		},
		/** Tokenize a raw string directly (useful for custom block nodes). */
		tokenize(/** @type {string} */ raw) {
			return scan(raw, 0, raw.length, cfg);
		},
	};
};

export const defaultInlineParser = createInlineParser();
