/**
 * Inline tokenizer for the markdown editor.
 *
 * Converts a single line of raw markdown text into an array of `InlineToken`
 * objects. Every token carries both its exact source characters (`raw`) and
 * byte offsets (`start`/`end`) relative to the line's raw string.
 *
 * ## Usage — default tokenizer (quick start)
 *
 * ```js
 * import { tokenizeInline } from './inline.js';
 * const tokens = tokenizeInline('Hello **world**');
 * ```
 *
 * ## Usage — custom tokenizer via factory
 *
 * ```js
 * import { createInlineParser } from './inline.js';
 * const { tokenizeInline } = createInlineParser({
 *   image: false,
 *   strike: { delimiter: '~' },
 *   custom: [highlightRule, mentionRule],
 * });
 * ```
 *
 * ## Algorithm
 *
 * Left-to-right single pass with no backtracking. At each position `i`:
 *   1. Run custom rules first (in order). First match wins.
 *   2. Identify the built-in character class and attempt to close the span.
 *   3. If no match → accumulate the char in a lazy text run and advance by 1.
 *
 * Text runs are flushed into a `text` token only when a non-text token is
 * emitted, avoiding one-char text tokens for every plain character.
 *
 * ## Supported inline syntax (all configurable)
 *
 * | Syntax          | Token type  | Notes                               |
 * |-----------------|-------------|-------------------------------------|
 * | `\X`            | escape      | Any ASCII punctuation after `\`     |
 * | `` `code` ``    | code        | Any backtick run length             |
 * | `~~text~~`      | strike      | Delimiter configurable              |
 * | `***text***`    | bold_italic | `___` also works                    |
 * | `**text**`      | bold        | `__` also works                     |
 * | `*text*`        | italic      | `_` with word-boundary guard        |
 * | `![alt](url)`   | image       |                                     |
 * | `[text](url)`   | link        |                                     |
 * | (custom rules)  | any string  | Runs before all built-in handlers   |
 * | (everything else) | text      |                                     |
 */

/**
 * @import { InlineToken, InlineTokenType, InlineParserOptions, CustomInlineRule } from './types';
 */

// ---------------------------------------------------------------------------
// Private scan helpers (pure — no config dependency)
// ---------------------------------------------------------------------------

/**
 * Find the next closing run of EXACTLY `len` consecutive `delimChar`
 * characters, starting at `from`. Runs of a different length are skipped.
 *
 * For underscore delimiters, the character immediately after the closing run
 * must not be a word character (`\w`) — prevents `snake_case` false matches.
 *
 * @param {string} str
 * @param {number} from
 * @param {string} delimChar - `'*'` or `'_'`
 * @param {number} len
 * @param {number} [maxEnd]
 * @returns {number} Index of the closing run start, or -1.
 */
const findEmphasisClose = (str, from, delimChar, len, maxEnd = str.length) => {
	let i = from;
	while (i < maxEnd) {
		if (str[i] == delimChar) {
			let runLen = 0;
			while (i + runLen < maxEnd && str[i + runLen] == delimChar) runLen++;
			if (runLen == len) {
				if (delimChar == '_') {
					const after = str[i + runLen];
					if (after != undefined && /\w/.test(after)) {
						i += runLen;
						continue;
					}
				}
				return i;
			}
			i += runLen;
		} else {
			i++;
		}
	}
	return -1;
};

/**
 * Find the next run of exactly `len` consecutive backticks at or after `from`.
 * @param {string} str
 * @param {number} from
 * @param {number} len
 * @param {number} [maxEnd]
 * @returns {number}
 */
const findBacktickClose = (str, from, len, maxEnd = str.length) => {
	let i = from;
	while (i < maxEnd) {
		if (str[i] == '`') {
			let runLen = 0;
			while (i + runLen < maxEnd && str[i + runLen] == '`') runLen++;
			if (runLen == len) return i;
			i += runLen;
		} else {
			i++;
		}
	}
	return -1;
};

/**
 * Find the closing `]` matching the `[` that opened at `from - 1`.
 * Accounts for nested brackets.
 * @param {string} str
 * @param {number} from - Index AFTER the opening `[`.
 * @param {number} [maxEnd]
 * @returns {number}
 */
const findClosingBracket = (str, from, maxEnd = str.length) => {
	let depth = 1;
	for (let i = from; i < maxEnd; i++) {
		if (str[i] == '[') depth++;
		else if (str[i] == ']' && --depth == 0) return i;
	}
	return -1;
};

/**
 * Find the closing `)` matching the `(` that opened at `from - 1`.
 * Accounts for nested parens.
 * @param {string} str
 * @param {number} from - Index AFTER the opening `(`.
 * @param {number} [maxEnd]
 * @returns {number}
 */
const findClosingParen = (str, from, maxEnd = str.length) => {
	let depth = 1;
	for (let i = from; i < maxEnd; i++) {
		if (str[i] == '(') depth++;
		else if (str[i] == ')' && --depth == 0) return i;
	}
	return -1;
};

// ---------------------------------------------------------------------------
// Compiled inline config
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   escapeEnabled:    boolean,
 *   codeEnabled:      boolean,
 *   strikeEnabled:    boolean,
 *   strikeDelimiter:  string,
 *   strikeTrigger:    string,
 *   boldEnabled:      boolean,
 *   italicEnabled:    boolean,
 *   boldItalicEnabled: boolean,
 *   linkEnabled:      boolean,
 *   imageEnabled:     boolean,
 *   customRules:      CustomInlineRule[],
 * }} CompiledInlineConfig
 */

/**
 * Compile an `InlineParserOptions` object into the internal config shape.
 * Called once per `createInlineParser` call.
 *
 * @param {InlineParserOptions} [options]
 * @returns {CompiledInlineConfig}
 */
const compileInlineConfig = (options = {}) => {
	const strikeOpts = options.strike;
	const strikeEnabled = strikeOpts != false;
	const strikeDelimiter =
		typeof strikeOpts == 'object' && strikeOpts != null && strikeOpts.delimiter
			? strikeOpts.delimiter
			: '~~';

	const boldEnabled = options.bold != false;
	const italicEnabled = options.italic != false;

	return {
		escapeEnabled: options.escape != false,
		codeEnabled: options.code != false,
		strikeEnabled,
		strikeDelimiter,
		strikeTrigger: strikeDelimiter[0] ?? '~',
		boldEnabled,
		italicEnabled,
		// bold_italic requires both to be on; otherwise *** is ambiguous
		boldItalicEnabled: boldEnabled && italicEnabled,
		linkEnabled: options.link != false,
		imageEnabled: options.image != false,
		customRules: options.custom ?? [],
	};
};

// ---------------------------------------------------------------------------
// Core tokenize function (takes a compiled config)
// ---------------------------------------------------------------------------

/**
 * @param {string}              raw
 * @param {number}              scanStart
 * @param {number}              scanEnd
 * @param {CompiledInlineConfig} cfg
 * @returns {InlineToken[]}
 */
const tokenizeInlineWithConfig = (raw, scanStart, scanEnd, cfg) => {
	/** @type {InlineToken[]} */
	const tokens = [];
	let i = scanStart;
	let textStart = -1;

	/**
	 * Flush pending text run up to (not including) `end`.
	 * @param {number} end
	 */
	const flushText = (end) => {
		if (textStart >= 0 && textStart < end) {
			tokens.push({
				type: 'text',
				raw: raw.slice(textStart, end),
				content: raw.slice(textStart, end),
				start: textStart,
				end,
			});
		}
		textStart = -1;
	};

	/**
	 * Open (or extend) a text run at `pos`.
	 * @param {number} pos
	 */
	const appendText = (pos) => {
		if (textStart < 0) textStart = pos;
	};

	// -------------------------------------------------------------------------
	// Main scan loop
	// -------------------------------------------------------------------------
	outer: while (i < scanEnd) {
		const ch = raw[i];

		// -----------------------------------------------------------------------
		// Custom rules — tested first at every position
		// -----------------------------------------------------------------------
		for (const rule of cfg.customRules) {
			const token = rule.scan(raw, i, scanEnd);
			if (token != null && token != undefined) {
				flushText(i);
				tokens.push(token);
				i = token.end;
				continue outer;
			}
		}

		// -----------------------------------------------------------------------
		// Escape: \X
		// -----------------------------------------------------------------------
		if (cfg.escapeEnabled && ch == '\\' && i + 1 < scanEnd) {
			flushText(i);
			tokens.push({
				type: 'escape',
				raw: raw.slice(i, i + 2),
				content: raw[i + 1],
				start: i,
				end: i + 2,
			});
			i += 2;
			continue;
		}

		// -----------------------------------------------------------------------
		// Inline code: `...` or ``...`` etc.
		// -----------------------------------------------------------------------
		if (cfg.codeEnabled && ch == '`') {
			let tickCount = 0;
			while (i + tickCount < scanEnd && raw[i + tickCount] == '`') tickCount++;

			const closeIdx = findBacktickClose(raw, i + tickCount, tickCount);
			if (closeIdx != -1) {
				flushText(i);
				const inner = raw.slice(i + tickCount, closeIdx);
				// CommonMark: strip exactly one leading/trailing space when both present
				// and content is not all spaces.
				const content =
					inner.length > 0 &&
					inner[0] == ' ' &&
					inner[inner.length - 1] == ' ' &&
					inner.trim() != ''
						? inner.slice(1, -1)
						: inner;
				tokens.push({
					type: 'code',
					raw: raw.slice(i, closeIdx + tickCount),
					content,
					start: i,
					end: closeIdx + tickCount,
				});
				i = closeIdx + tickCount;
				continue;
			}
			appendText(i);
			i += tickCount;
			continue;
		}

		// -----------------------------------------------------------------------
		// Strikethrough: configurable delimiter (default ~~)
		// -----------------------------------------------------------------------
		if (cfg.strikeEnabled && ch == cfg.strikeTrigger) {
			const delim = cfg.strikeDelimiter;
			const delimLen = delim.length;

			if (raw.startsWith(delim, i)) {
				// Search for the closing delimiter
				let j = i + delimLen;
				let closeIdx = -1;
				while (j <= scanEnd - delimLen) {
					if (raw.startsWith(delim, j)) {
						closeIdx = j;
						break;
					}
					j++;
				}

				if (closeIdx != -1) {
					flushText(i);
					const innerStart = i + delimLen;
					tokens.push({
						type: 'strike',
						raw: raw.slice(i, closeIdx + delimLen),
						content: raw.slice(i + delimLen, closeIdx),
						start: i,
						end: closeIdx + delimLen,
						children: tokenizeInlineWithConfig(raw, innerStart, closeIdx, cfg)
					});
					i = closeIdx + delimLen;
					continue;
				}
				// No close — consume the whole delimiter as text and move on
				appendText(i);
				i += delimLen;
				continue;
			}
		}

		// -----------------------------------------------------------------------
		// Emphasis: * ** *** and _ __ ___
		// -----------------------------------------------------------------------
		if (ch == '*' || ch == '_') {
			const delimChar = ch;

			// Underscore opening guard: skip if preceded by a word char
			if (delimChar == '_') {
				const before = i > 0 ? raw[i - 1] : null;
				if (before != null && /\w/.test(before)) {
					appendText(i);
					i++;
					continue;
				}
			}

			// Count the full opening run
			let openCount = 0;
			while (i + openCount < scanEnd && raw[i + openCount] == delimChar) openCount++;

			const excess = Math.max(0, openCount - 3);
			const len = Math.min(openCount, 3);

			// Is this delimiter length enabled?
			const lenEnabled =
				(len == 3 && cfg.boldItalicEnabled) ||
				(len == 2 && cfg.boldEnabled) ||
				(len == 1 && cfg.italicEnabled);

			const closeIdx = lenEnabled ? findEmphasisClose(raw, i + openCount, delimChar, len) : -1;

			if (closeIdx != -1) {
				flushText(i);
				if (excess > 0) {
					tokens.push({
						type: 'text',
						raw: raw.slice(i, i + excess),
						content: raw.slice(i, i + excess),
						start: i,
						end: i + excess,
					});
				}
				const tokenStart = i + excess;
				const innerStart = tokenStart + len;
				/** @type {InlineTokenType} */
				const type = len == 3 ? 'bold_italic' : len == 2 ? 'bold' : 'italic';
				tokens.push({
					type,
					raw: raw.slice(tokenStart, closeIdx + len),
					content: raw.slice(tokenStart + len, closeIdx),
					start: tokenStart,
					end: closeIdx + len,
					children: tokenizeInlineWithConfig(raw, innerStart, closeIdx, cfg),
				});
				i = closeIdx + len;
				continue;
			}

			appendText(i);
			i += openCount;
			continue;
		}

		// -----------------------------------------------------------------------
		// Image: ![alt](url)  — checked before link because both start with `[`
		// -----------------------------------------------------------------------
		if (cfg.imageEnabled && ch == '!' && raw[i + 1] == '[') {
			const bracketOpen = i + 2;
			const bracketClose = findClosingBracket(raw, bracketOpen);

			if (bracketClose != -1 && raw[bracketClose + 1] == '(') {
				const parenOpen = bracketClose + 2;
				const parenClose = findClosingParen(raw, parenOpen);

				if (parenClose != -1) {
					flushText(i);
					const alt = raw.slice(bracketOpen, bracketClose);
					const href = raw.slice(parenOpen, parenClose);
					tokens.push({
						type: 'image',
						raw: raw.slice(i, parenClose + 1),
						content: alt,
						alt,
						href,
						start: i,
						end: parenClose + 1,
					});
					i = parenClose + 1;
					continue;
				}
			}
			appendText(i);
			i++;
			continue;
		}

		// -----------------------------------------------------------------------
		// Link: [text](url)
		// -----------------------------------------------------------------------
		if (cfg.linkEnabled && ch == '[') {
			const bracketOpen = i + 1;
			const bracketClose = findClosingBracket(raw, bracketOpen);

			if (bracketClose != -1 && raw[bracketClose + 1] == '(') {
				const parenOpen = bracketClose + 2;
				const parenClose = findClosingParen(raw, parenOpen);

				if (parenClose != -1) {
					flushText(i);
					const label = raw.slice(bracketOpen, bracketClose);
					const href = raw.slice(parenOpen, parenClose);
					tokens.push({
						type: 'link',
						raw: raw.slice(i, parenClose + 1),
						content: label,
						href,
						start: i,
						end: parenClose + 1,
						children: tokenizeInlineWithConfig(raw, bracketOpen, bracketClose, cfg),
					});
					i = parenClose + 1;
					continue;
				}
			}
			appendText(i);
			i++;
			continue;
		}

		// -----------------------------------------------------------------------
		// Plain text fallthrough
		// -----------------------------------------------------------------------
		appendText(i);
		i++;
	}

	flushText(scanEnd);
	return tokens;
};

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Create an inline tokenizer configured with the given options.
 *
 * Options are compiled once; the returned functions carry zero per-call
 * overhead from option resolution.
 *
 * ```js
 * const parser = createInlineParser({
 *   image: false,
 *   strike: { delimiter: '~' },
 *   custom: [highlightRule, mentionRule],
 * });
 *
 * const tokens = parser.tokenizeInline('Hello ==world== and ~struck~');
 * ```
 *
 * @param {InlineParserOptions} [options]
 * @returns {{
 *   tokenizeInline: (raw: string, contentStart?: number) => InlineToken[],
 *   tokenizeBlock:  (block: import('./types.js').Block, contentStart: number) => InlineToken[],
 * }}
 */
export const createInlineParser = (options = {}) => {
	const cfg = compileInlineConfig(options);

	return {
		/**
		 * Tokenize a single raw line string.
		 * @param {string} raw
		 * @param {number} [contentStart=0]
		 * @returns {InlineToken[]}
		 */
		tokenizeInline(raw, contentStart = 0) {
			return tokenizeInlineWithConfig(raw, contentStart, raw.length, cfg);
		},

		/**
		 * Tokenize the inline content of a Block, skipping the block prefix.
		 * @param {import('./types.js').Block} block
		 * @param {number} contentStart - From `getBlockContentStart(block)`
		 * @returns {InlineToken[]}
		 */
		tokenizeBlock(block, contentStart) {
			if (contentStart >= block.raw.length) return [];
			return tokenizeInlineWithConfig(block.raw, contentStart, block.raw.length, cfg);
		},
	};
};

// ---------------------------------------------------------------------------
// Default parser instance + standalone convenience exports
// ---------------------------------------------------------------------------

/** The default inline parser (all built-in features enabled, no custom rules). */
const defaultInlineParser = createInlineParser();

/**
 * Tokenize a single line of raw markdown into an array of inline tokens.
 * Uses the default tokenizer (all features enabled, no custom rules).
 *
 * All `token.start` and `token.end` values are byte offsets within `raw`.
 * Invariant: `raw.slice(token.start, token.end) == token.raw`.
 *
 * ```js
 * import { parseBlocks, getBlockContentStart } from './block.js';
 * import { tokenizeInline } from './inline.js';
 *
 * const blocks = parseBlocks('# Hello **world**');
 * const heading = blocks[0];
 * const tokens = tokenizeInline(heading.raw, getBlockContentStart(heading));
 * // → [
 * //     { type: 'text', raw: 'Hello ', content: 'Hello ', start: 2, end: 8 },
 * //     { type: 'bold', raw: '**world**', content: 'world', start: 8, end: 17 }
 * //   ]
 * ```
 *
 * @param {string} raw
 * @param {number} [contentStart=0]
 * @returns {InlineToken[]}
 */
export const tokenizeInline = (raw, contentStart = 0) =>
	defaultInlineParser.tokenizeInline(raw, contentStart);

/**
 * Tokenize the inline content of a Block, skipping the block-level prefix.
 * Uses the default tokenizer.
 *
 * ```js
 * import { parseBlocks, getBlockContentStart } from './block.js';
 * import { tokenizeBlock } from './inline.js';
 *
 * const [block] = parseBlocks('> *quoted*');
 * const tokens = tokenizeBlock(block, getBlockContentStart(block));
 * ```
 *
 * @param {import('./types.js').Block} block
 * @param {number} contentStart - From `getBlockContentStart(block)`
 * @returns {InlineToken[]}
 */
export const tokenizeBlock = (block, contentStart) =>
	defaultInlineParser.tokenizeBlock(block, contentStart);
