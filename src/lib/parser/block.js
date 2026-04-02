/**
 * Block-level parser for the markdown editor.
 *
 * Splits a raw markdown string into an array of `Block` objects — one per
 * source line. Each Block carries its type (heading, code fence, list item,
 * etc.) and any type-specific metadata needed for rendering and cursor mapping.
 *
 * ## Usage — default parser (quick start)
 *
 * ```js
 * import { parseBlocks, getBlockContentStart } from './block.js';
 * const blocks = parseBlocks('# Hello\n\nWorld');
 * ```
 *
 * ## Usage — custom parser via factory
 *
 * ```js
 * import { createBlockParser } from './block.js';
 * const { parseBlocks } = createBlockParser({
 *   codeFence: { chars: ['`'] },  // backtick-only fences
 *   blockquote: false,
 *   custom: [calloutRule],
 * });
 * ```
 *
 * ## Design notes
 * - Every line maps to exactly one Block.
 * - Setext-style headings are not supported; ATX (`#`) only.
 * - The only cross-line state is the code fence open/close pair.
 * - `createBlockParser` compiles options once
 */

/**
 * @import { Block, BlockMeta, BlockParserOptions, CustomBlockRule, BlockParseContext } from './types';
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe use inside a RegExp character class or alternation.
 * @param {string} s
 * @returns {string}
 */
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Build the block-level regex pair for fence delimiters from an array of
 * single characters (e.g. `['`', '~']`).
 *
 * Open fence: `^(<chars>{3,})(.*)`
 * Close fence: `^(<chars>{3,})\s*$`
 *
 * @param {string[]} chars
 * @returns {{ open: RegExp, close: RegExp }}
 */
const buildFenceRegexes = (chars) => {
	const alts = chars.map((c) => `${escapeRegex(c)}{3,}`).join('|');
	return {
		open: new RegExp(`^(${alts})(.*)`),
		close: new RegExp(`^(${alts})\\s*$`),
	};
};

// Default fence regexes (used by the default parser instance)
const DEFAULT_FENCE = buildFenceRegexes(['`', '~']);

/** Matches 1–6 `#` followed by a space or end of line. */
const HEADING_RE = /^(#{1,6})(?:\s|$)/;

/** Matches a blockquote prefix `>` + optional space. */
const BLOCKQUOTE_RE = /^>\s?/;

/**
 * HR: 3+ of the same character (`-`, `*`, `_`) with optional spaces between,
 * preceded by up to 3 spaces.
 */
const HR_RE = /^[ \t]{0,3}([-*_])(\s*\1){2,}\s*$/;

/** Unordered list: optional indent, then `-`, `*`, or `+`, then a space. */
const UNORDERED_LIST_RE = /^(\s*)([-*+])\s+/;

/** Ordered list: optional indent, digits, `.` or `)`, then a space. */
const ORDERED_LIST_RE = /^(\s*)(\d+)[.)]\s+/;

/** Blank or whitespace-only line. */
const BLANK_RE = /^\s*$/;

/**
 * @param {string} line
 * @returns {{ depth: number, contentStart: number }}
 */
const parseBlockquoteDepth = (line) => {
	let i = 0;
	let depth = 0;
	while (i < line.length && line[i] == '>') {
		depth++;
		i++; // consume `>`
		if (line[i] == ' ') i += line.substring(i).match(/^( {1,4})/)[0].length // consume up to 4 spaces
		else if (line[1] == '\t') i++; // Consume tab
	}
	return { depth, contentStart: i };
}

// ---------------------------------------------------------------------------
// Compiled config
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   headingEnabled:    boolean,
 *   codeFenceEnabled:  boolean,
 *   fenceOpen:         RegExp,
 *   fenceClose:        RegExp,
 *   blockquoteEnabled: boolean,
 *   listEnabled:       boolean,
 *   hrEnabled:         boolean,
 *   customRules:       CustomBlockRule[],
 * }} CompiledBlockConfig
 */

/**
 * Compile a `BlockParserOptions` object into the internal config shape.
 * Called once per `createBlockParser` call.
 *
 * @param {BlockParserOptions} [options]
 * @returns {CompiledBlockConfig}
 */
const compileBlockConfig = (options = {}) => {
	const fenceOpts = options.codeFence;
	const codeFenceEnabled = fenceOpts != false;

	let fenceOpen = DEFAULT_FENCE.open;
	let fenceClose = DEFAULT_FENCE.close;

	if (codeFenceEnabled && typeof fenceOpts == 'object' && fenceOpts != null) {
		const chars = fenceOpts.chars;
		if (Array.isArray(chars) && chars.length > 0) {
			const built = buildFenceRegexes(chars);
			fenceOpen = built.open;
			fenceClose = built.close;
		}
	}

	return {
		headingEnabled: options.heading != false,
		codeFenceEnabled,
		fenceOpen,
		fenceClose,
		blockquoteEnabled: options.blockquote != false,
		listEnabled: options.list != false,
		hrEnabled: options.hr != false,
		customRules: options.custom ?? [],
	};
};

// ---------------------------------------------------------------------------
// Core parse function (takes a compiled config)
// ---------------------------------------------------------------------------

/**
 * Normalise the return value of a `CustomBlockRule.test` call into a
 * `BlockMeta | null`. Returns `null` when the rule did not match.
 *
 * @param {BlockMeta | boolean | null | undefined} result
 * @returns {BlockMeta | null}
 */
const resolveCustomMeta = (result) => {
	if (!result) return null; // false, null, undefined
	if (typeof result == 'object') return result; // BlockMeta object
	return {}; // true or other truthy
};

/**
 * Internal implementation of block parsing. Accepts a pre-compiled config
 * so callers pay the compilation cost only once.
 *
 * @param {string}             raw
 * @param {CompiledBlockConfig} cfg
 * @returns {Block[]}
 */
const parseBlocksWithConfig = (raw, cfg) => {
	const lines = raw.split('\n');
	/** @type {Block[]} */
	const blocks = [];

	// Code fence state — the only cross-line state we track.
	let inCodeFence = false;
	let fenceMarker = '';
	let fenceLang = '';

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const line = lines[lineIndex];

		// -----------------------------------------------------------------------
		// 1. Code fence body / close (highest priority — always active when open)
		// -----------------------------------------------------------------------
		if (inCodeFence) {
			const closeMatch = line.match(cfg.fenceClose);
			if (
				closeMatch &&
				closeMatch[1][0] == fenceMarker[0] && // same fence character
				closeMatch[1].length >= fenceMarker.length // at least as long
			) {
				blocks.push({ raw: line, type: 'code_fence_close', meta: { lang: fenceLang }, lineIndex });
				inCodeFence = false;
				fenceMarker = '';
				fenceLang = '';
			} else {
				blocks.push({ raw: line, type: 'code_fence_body', meta: { lang: fenceLang }, lineIndex });
			}
			continue;
		}

		// -----------------------------------------------------------------------
		// 2. Blank line (always recognised — cannot be disabled)
		// -----------------------------------------------------------------------
		if (BLANK_RE.test(line)) {
			blocks.push({ raw: line, type: 'blank', meta: {}, lineIndex });
			continue;
		}

		// -----------------------------------------------------------------------
		// 3. Custom rules — tested before all built-in rules
		// -----------------------------------------------------------------------
		if (cfg.customRules.length > 0) {
			/** @type {BlockParseContext} */
			const ctx = { inCodeFence, fenceMarker, fenceLang, lineIndex };
			let claimed = false;

			for (const rule of cfg.customRules) {
				const result = rule.test(line, ctx);
				const meta = resolveCustomMeta(result);
				if (meta != null) {
					blocks.push({ raw: line, type: rule.type, meta, lineIndex });
					claimed = true;
					break;
				}
			}
			if (claimed) continue;
		}

		// -----------------------------------------------------------------------
		// 4. Fenced code block — opening fence
		// -----------------------------------------------------------------------
		if (cfg.codeFenceEnabled) {
			const fenceMatch = line.match(cfg.fenceOpen);
			if (fenceMatch) {
				fenceMarker = fenceMatch[1];
				fenceLang = fenceMatch[2].trim();
				inCodeFence = true;
				blocks.push({ raw: line, type: 'code_fence_open', meta: { lang: fenceLang }, lineIndex });
				continue;
			}
		}

		// -----------------------------------------------------------------------
		// 5. ATX Heading
		// -----------------------------------------------------------------------
		if (cfg.headingEnabled) {
			const m = line.match(HEADING_RE);
			if (m) {
				blocks.push({ raw: line, type: 'heading', meta: { level: m[1].length }, lineIndex });
				continue;
			}
		}

		// -----------------------------------------------------------------------
		// 6. Thematic break — checked before unordered list because `- - -` is HR
		// -----------------------------------------------------------------------
		if (cfg.hrEnabled && HR_RE.test(line)) {
			blocks.push({ raw: line, type: 'hr', meta: {}, lineIndex });
			continue;
		}

		// -----------------------------------------------------------------------
		// 7. Blockquote
		// -----------------------------------------------------------------------
		if (cfg.blockquoteEnabled && BLOCKQUOTE_RE.test(line)) {
			const { depth } = parseBlockquoteDepth(line);
			blocks.push({ raw: line, type: 'blockquote', meta: { depth }, lineIndex });
			continue;
		}

		// -----------------------------------------------------------------------
		// 8. List items (unordered then ordered)
		// -----------------------------------------------------------------------
		if (cfg.listEnabled) {
			const getDepth = (/** @type {number} */ indent) => {
				if (blocks.length == 0) return 1;
				const prevBlock = blocks[blocks.length - 1];
				if (typeof prevBlock.meta.indent == 'number') {
					const prevIndent = prevBlock.meta.indent;
					const prevDepth = prevBlock.meta.depth ?? 1;
					if (indent > prevIndent) return prevDepth + 1;
					if (indent < prevIndent) return prevDepth - 1;
					return prevDepth;
				}
				return 1
			}

			const ulMatch = line.match(UNORDERED_LIST_RE);
			if (ulMatch) {
				const indent = ulMatch[1].length;
				blocks.push({
					raw: line,
					type: 'list_item',
					lineIndex,
					meta: { ordered: false, listMarker: ulMatch[2], depth: getDepth(indent), indent },
				});
				continue;
			}
			const olMatch = line.match(ORDERED_LIST_RE);
			if (olMatch) {
				const indent = olMatch[1].length;
				blocks.push({
					raw: line,
					type: 'list_item',
					lineIndex,
					meta: { ordered: true, listMarker: olMatch[2] + '.', depth: getDepth(indent), indent },
				});
				continue;
			}
		}

		// -----------------------------------------------------------------------
		// 9. Paragraph — catch-all
		// -----------------------------------------------------------------------
		blocks.push({ raw: line, type: 'paragraph', meta: {}, lineIndex });
	}

	return blocks;
};

// ---------------------------------------------------------------------------
// getBlockContentStart (takes compiled config for custom-rule support)
// ---------------------------------------------------------------------------

/**
 * @param {Block}              block
 * @param {CompiledBlockConfig} cfg
 * @returns {number}
 */
const getBlockContentStartWithConfig = (block, cfg) => {
	switch (block.type) {
		case 'paragraph':
		case 'blank':
			return 0;

		case 'heading': {
			const level = block.meta.level ?? 1;
			const afterHashes = block.raw[level];
			return afterHashes == ' ' || afterHashes == '\t' ? level + 1 : level;
		}

		case 'blockquote':
			return parseBlockquoteDepth(block.raw).contentStart;

		case 'list_item': {
			const ulMatch = block.raw.match(UNORDERED_LIST_RE);
			if (ulMatch) return ulMatch[0].length;
			const olMatch = block.raw.match(ORDERED_LIST_RE);
			if (olMatch) return olMatch[0].length;
			return 0;
		}

		case 'code_fence_open':
		case 'code_fence_body':
		case 'code_fence_close':
		case 'hr':
			return block.raw.length; // opaque — no inline content

		default: {
			// Look for a matching custom rule and use its contentStart if provided.
			const rule = cfg.customRules.find((r) => r.type == block.type);
			if (rule) {
				if (rule.opaque) return block.raw.length;
				if (typeof rule.contentStart == 'function') {
					return rule.contentStart(block.raw, block.meta);
				}
			}
			return 0;
		}
	}
};

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Create a block parser configured with the given options.
 *
 * Options are compiled once; the returned functions carry zero per-call
 * overhead from option resolution.
 *
 * ```js
 * const parser = createBlockParser({
 *   codeFence: { chars: ['`'] },   // backtick-only fences
 *   blockquote: false,              // disable blockquotes
 *   custom: [calloutRule],
 * });
 *
 * const blocks = parser.parseBlocks('# Hello\n> ignored\n```js\ncode\n```');
 * ```
 *
 * @param {BlockParserOptions} [options]
 * @returns {{
 *   parseBlocks:           (raw: string) => Block[],
 *   getBlockContentStart:  (block: Block) => number,
 *   getBlockInlineRaw:     (block: Block) => string,
 *   serializeBlocks:       (blocks: Block[]) => string,
 * }}
 */
export const createBlockParser = (options = {}) => {
	const cfg = compileBlockConfig(options);

	return {
		/**
		 * Parse a full markdown document string into Block objects.
		 * @param {string} raw
		 * @returns {Block[]}
		 */
		parseBlocks(raw) {
			return parseBlocksWithConfig(raw, cfg);
		},

		/**
		 * Returns the byte offset within `block.raw` where inline content begins.
		 * Correctly handles custom block types via their `contentStart` function.
		 * @param {Block} block
		 * @returns {number}
		 */
		getBlockContentStart(block) {
			return getBlockContentStartWithConfig(block, cfg);
		},

		/**
		 * Returns the portion of `block.raw` after the block-level syntax prefix.
		 * @param {Block} block
		 * @returns {string}
		 */
		getBlockInlineRaw(block) {
			return block.raw.slice(getBlockContentStartWithConfig(block, cfg));
		},

		/**
		 * Serialize blocks back to a raw markdown string.
		 * @param {Block[]} blocks
		 * @returns {string}
		 */
		serializeBlocks(blocks) {
			return blocks.map((b) => b.raw).join('\n');
		},
	};
};

// ---------------------------------------------------------------------------
// Default parser instance + standalone convenience exports
// ---------------------------------------------------------------------------

/** The default block parser (all built-in features enabled, no custom rules). */
const defaultBlockParser = createBlockParser();

/**
 * Parse a full markdown document string into an array of Block objects.
 * Uses the default parser (all features enabled).
 *
 * ```js
 * const blocks = parseBlocks('# Hello\n\nWorld');
 * // blocks[0] → { type: 'heading', meta: { level: 1 }, raw: '# Hello', lineIndex: 0 }
 * // blocks[1] → { type: 'blank',   meta: {},           raw: '',        lineIndex: 1 }
 * // blocks[2] → { type: 'paragraph', meta: {},         raw: 'World',   lineIndex: 2 }
 * ```
 *
 * @param {string} raw
 * @returns {Block[]}
 */
export const parseBlocks = (raw) => defaultBlockParser.parseBlocks(raw);

/**
 * Returns the byte offset within `block.raw` where inline content begins.
 * Uses the default parser — unknown `block.type` values return `0`.
 *
 * | Block type         | Example raw          | Content start |
 * |--------------------|----------------------|---------------|
 * | paragraph          | `Hello world`        | 0             |
 * | heading (level 2)  | `## My heading`      | 3             |
 * | blockquote         | `> Some text`        | 2             |
 * | list_item (ul)     | `- Item text`        | 2             |
 * | list_item (ol)     | `1. First`           | 3             |
 * | code_fence_open    | ` ```js `            | raw.length    |
 * | code_fence_body    | `const x = 1`        | raw.length    |
 * | code_fence_close   | ` ``` `              | raw.length    |
 * | hr                 | `---`                | raw.length    |
 * | blank              | `` (empty)           | 0             |
 *
 * @param {Block} block
 * @returns {number}
 */
export const getBlockContentStart = (block) => defaultBlockParser.getBlockContentStart(block);

/**
 * Returns the portion of `block.raw` that contains inline markdown content.
 * Returns an empty string for opaque blocks (code fences, HR).
 *
 * @param {Block} block
 * @returns {string}
 */
export const getBlockInlineRaw = (block) => defaultBlockParser.getBlockInlineRaw(block);

/**
 * Serialize an array of blocks back into a raw markdown string.
 * Each block's `raw` field is joined with newlines.
 *
 * @param {Block[]} blocks
 * @returns {string}
 */
export const serializeBlocks = (blocks) => defaultBlockParser.serializeBlocks(blocks);
