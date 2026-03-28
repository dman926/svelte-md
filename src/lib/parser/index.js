/**
 * Combined parser factory for the markdown editor.
 *
 * `createParser` is the primary public API for configuring the parser.
 * It composes `createBlockParser` and `createInlineParser` into a single
 * `Parser` object whose methods are all aware of the same option set.
 *
 * ```js
 * import { createParser, defaultParser } from './parser.js';
 *
 * // Use the default parser (all features on, no custom rules)
 * const blocks = defaultParser.parseBlocks('# Hello\n\n**world**');
 * const tokens = defaultParser.tokenizeBlock(blocks[0]);
 *
 * // Create a customised parser
 * const myParser = createParser({
 *   block: {
 *     codeFence: { chars: ['`'] },   // backtick-only fences
 *     blockquote: false,
 *     custom: [calloutRule],
 *   },
 *   inline: {
 *     image: false,
 *     strike: { delimiter: '~' },
 *     custom: [highlightRule, mentionRule],
 *   },
 * });
 * ```
 */

/**
 * @import { Parser, ParserOptions, Block, InlineToken} from './types';
 */

import { createBlockParser } from './block.js';
import { createInlineParser } from './inline.js';

export * from './types.js';

/**
 * Create a fully configured parser that combines the block and inline parsers.
 *
 * The returned `Parser` object exposes:
 * - `parseBlocks(raw)`            — split a document into Block objects
 * - `getBlockContentStart(block)` — byte offset where inline content starts
 * - `getBlockInlineRaw(block)`    — raw inline content of a block
 * - `serializeBlocks(blocks)`     — join blocks back into a raw string
 * - `tokenizeInline(raw, start?)` — tokenize a raw line string
 * - `tokenizeBlock(block)`        — tokenize a block's inline content
 * - `options`                     — the options this parser was created with
 *
 * @param {ParserOptions} [options]
 * @returns {Parser}
 */
export const createParser = (options = {}) => {
	const blockParser = createBlockParser(options.block);
	const inlineParser = createInlineParser(options.inline);

	return {
		parseBlocks(raw) {
			return blockParser.parseBlocks(raw);
		},

		getBlockContentStart(block) {
			return blockParser.getBlockContentStart(block);
		},

		getBlockInlineRaw(block) {
			return blockParser.getBlockInlineRaw(block);
		},

		serializeBlocks(blocks) {
			return blockParser.serializeBlocks(blocks);
		},

		tokenizeInline(raw, contentStart = 0) {
			return inlineParser.tokenizeInline(raw, contentStart);
		},

		/**
		 * Tokenize a block's inline content, computing `contentStart` automatically.
		 * Returns `[]` for opaque blocks (code fences, HR, and custom opaque blocks).
		 *
		 * @param {Block} block
		 * @returns {InlineToken[]}
		 */
		tokenizeBlock(block) {
			const contentStart = blockParser.getBlockContentStart(block);
			return inlineParser.tokenizeBlock(block, contentStart);
		},

		get options() {
			return options;
		},
	};
}

/**
 * A pre-built parser with all default settings.
 * All built-in block and inline features are enabled; no custom rules.
 *
 * Suitable for most use cases. Create a custom parser with `createParser`
 * only when you need to change defaults or add custom syntax rules.
 *
 * @type {Parser}
 */
export const defaultParser = createParser();
