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
 *   BlockNode, Document, Heading, Paragraph, InlineNode,
 *   InlineParserOptions, NodeRange, TextChunk, Position
 * } from './types';
 */

// ---------------------------------------------------------------------------
// Scan helpers (pure)
// ---------------------------------------------------------------------------

/** @param {TextChunk[]} chunks */
const createChunkMapper = (chunks) => {
	const raw = chunks.map((c) => c.text).join('\n');
	/** @type {Array<{ start: number; end: number; chunk: TextChunk }>} */
	const boundaries = [];
	let current = 0;

	for (const chunk of chunks) {
		boundaries.push({ start: current, end: current + chunk.text.length, chunk });
		current += chunk.text.length + 1; // +1 for the synthetic '\n'
	}

	/** @param {number} localOffset @returns {Position} */
	const getPos = (localOffset) => {
		for (const b of boundaries) {
			// If inside this chunk's text
			if (localOffset >= b.start && localOffset <= b.end) {
				return { line: b.chunk.line, offset: b.chunk.offset + (localOffset - b.start) };
			}
		}
		// Fallback for trailing ends
		const last = boundaries[boundaries.length - 1];
		if (!last) return { line: 0, offset: 0 };
		return { line: last.chunk.line, offset: last.chunk.offset + last.chunk.text.length };
	};

	return {
		raw,
		getRange: /** @param {number} start @param {number} end */ (start, end) => ({
			start: getPos(start),
			end: getPos(end),
		}),
	};
};

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
 * @param {(start: number, end: number) => NodeRange} getRange
 * @returns {InlineNode[]}
 */
const scan = (raw, scanStart, scanEnd, cfg, getRange) => {
	/** @type {InlineNode[]} */
	const nodes = [];
	let i = scanStart;
	let textBuf = '';
	let textStart = -1;

	const flushText = () => {
		if (textBuf) {
			nodes.push({ type: 'text', value: textBuf, range: getRange(textStart, i), raw: textBuf });
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
			const result = rule.scan(raw, i, scanEnd, getRange);
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
				nodes.push({ type: 'soft_break', range: getRange(i, i + 1), raw: ch });
			} else {
				// Collapse the newline to a single space character.
				// Flush any pending text first so ranges stay accurate.
				flushText();
				nodes.push({ type: 'text', value: ' ', range: getRange(i, i + 1), raw: ch });
			}
			i++;
			continue;
		}

		// Backslash escape
		if (cfg.escape && ch === '\\') {
			const next = raw[i + 1];
			if (next && /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(next)) {
				flushText();
				nodes.push({ type: 'escape', char: next, range: getRange(i, i + 2), raw: `${raw[i]}${raw[i+1]}` });
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
				const rawValue = raw.slice(i + tickLen, closeIdx);
				let value = rawValue
				if (value.length > 2 && value[0] === ' ' && value[value.length - 1] === ' ')
					value = value.slice(1, -1);
				nodes.push({ type: 'inline_code', value, range: getRange(i, closeIdx + tickLen), raw: rawValue });
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
					children: scan(raw, innerStart, closeIdx, cfg, getRange),
					range: getRange(i, closeIdx + dLen),
					raw: raw.slice(i, closeIdx + dLen),
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
						range: getRange(i, tokenStart),
						raw: raw.slice(i, tokenStart)
					});
				nodes.push({
					type: len === 2 ? 'bold' : 'italic',
					children: scan(raw, innerStart, closeIdx, cfg, getRange),
					range: getRange(tokenStart, closeIdx + len),
					raw: raw.slice(tokenStart, closeIdx + len)
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
						range: getRange(i, pClose + 1),
						raw: raw.slice(i, pClose + 1)
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
						children: scan(raw, bOpen, bClose, cfg, getRange),
						range: getRange(i, pClose + 1),
						raw: raw.slice(i, pClose + 1),
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
			const h = /** @type {Heading} */ (node);
			const mapper = createChunkMapper(h.chunks);
			h.children = scan(mapper.raw, 0, mapper.raw.length, cfg, mapper.getRange);
			break;
		}
		case 'paragraph': {
			const p = /** @type {Paragraph} */ (node);
			const mapper = createChunkMapper(p.chunks);
			p.children = scan(mapper.raw, 0, mapper.raw.length, cfg, mapper.getRange);
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
		tokenize(
			/** @type {string} */ raw,
			/** @type {(start: number, end: number) => NodeRange} */ getRange,
		) {
			return scan(raw, 0, raw.length, cfg, getRange);
		},
	};
};

export const defaultInlineParser = createInlineParser();
