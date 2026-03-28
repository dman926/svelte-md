/**
 * Types for the markdown editor parser.
 * Block types describe line-level structure.
 * Inline token types describe character-level formatting within a line.
 */

// ---------------------------------------------------------------------------
// Block types
// ---------------------------------------------------------------------------

/**
 * Describes the structural role of a single line in the document.
 */
export type BlockType =
	| 'paragraph'
	| 'heading'
	| 'code_fence_open'
	| 'code_fence_body'
	| 'code_fence_close'
	| 'blockquote'
	| 'list_item'
	| 'hr'
	| 'blank';

/**
 * Additional structured data attached to a Block, specific to its type.
 * Fields are only present when relevant to the block type.
 */
export interface BlockMeta {
	/**
	 * Heading level (1–6). Only present for `heading` blocks.
	 * Corresponds to the number of `#` characters.
	 */
	level?: number;

	/**
	 * Language identifier following the opening fence marker.
	 * Present on `code_fence_open`, `code_fence_body`, and `code_fence_close`.
	 * May be an empty string if no language was specified.
	 */
	lang?: string;

	/**
	 * Whether this list item uses an ordered marker (`1.`, `2.`, etc.).
	 * Present on `list_item` blocks.
	 */
	ordered?: boolean;

	/**
	 * The raw list marker character(s), e.g. `-`, `*`, `+`, or `1.`.
	 * Present on `list_item` blocks.
	 */
	listMarker?: string;

	/**
	 * Number of leading space characters before the list marker.
	 * Used to determine nesting depth. Present on `list_item` blocks.
	 */
	indent?: number;

	/** Open-ended extra fields for custom block rules to attach arbitrary data. */
	[key: string]: unknown;
}

/**
 * Represents a single line of the source document after block-level parsing.
 * Lines are the atomic unit of the editor's layout model.
 */
export interface Block {
	/**
	 * The exact source characters for this line, without the trailing newline.
	 */
	readonly raw: string;

	/** The structural role of this line. */
	type: BlockType | (string & {});

	/**
	 * Type-specific metadata. Always present (may be an empty object `{}`).
	 */
	meta: BlockMeta;

	/**
	 * 0-based index of this line within the full document's lines array.
	 * Used to map cursor positions back to source offsets.
	 */
	lineIndex: number;
}

// ---------------------------------------------------------------------------
// Inline token types
// ---------------------------------------------------------------------------

/**
 * Describes the formatting role of a span of characters within a line.
 *
 * - `text`        — Unstyled plain text
 * - `bold`        — `**text**` or `__text__`
 * - `italic`      — `*text*` or `_text_`
 * - `bold_italic` — `***text***` or `___text___`
 * - `code`        — `` `code` `` or ``` ``code`` ```
 * - `link`        — `[label](url)`
 * - `image`       — `![alt](url)`
 * - `strike`      — `~~text~~`
 * - `escape`      — `\X` — a backslash-escaped character
 */
export type InlineTokenType =
	| 'text'
	| 'bold'
	| 'italic'
	| 'bold_italic'
	| 'code'
	| 'link'
	| 'image'
	| 'strike'
	| 'escape';

/**
 * A single span of formatted (or plain) content within one line.
 *
 * Crucially, both `start` and `end` are **byte offsets into the block's `raw`
 * string** — not into the rendered DOM.
 *
 * The invariant `token.raw === block.raw.slice(token.start, token.end)` always
 * holds. The `content` field strips the surrounding syntax characters.
 *
 * @example
 * // For the raw line "Hello **world**":
 * // { type: 'text',  raw: 'Hello ', content: 'Hello ', start: 0, end: 6 }
 * // { type: 'bold',  raw: '**world**', content: 'world', start: 6, end: 15 }
 */
export interface InlineToken {
	/** The formatting role of this token. */
	type: InlineTokenType | (string & {});

	/**
	 * The exact source characters for this token, including any surrounding
	 * syntax (e.g. `"**hello**"`, not just `"hello"`).
	 * Invariant: `raw === block.raw.slice(start, end)`
	 */
	raw: string;

	/**
	 * The inner content of the token, stripped of syntax characters.
	 * For `text` tokens, this equals `raw`.
	 * For `bold`, this is the text between the `**` markers.
	 * For `link`, this is the visible label text.
	 * For `image`, this is the alt text.
	 * For `escape`, this is the single escaped character.
	 */
	content: string;

	/**
	 * Byte offset of the first character of this token within the block's `raw`.
	 * Inclusive.
	 */
	start: number;

	/**
	 * Byte offset one past the last character of this token within the block's `raw`.
	 * Exclusive. The token occupies `raw[start..end)`.
	 */
	end: number;

	/**
	 * The destination URL. Present only on `link` and `image` tokens.
	 * Contains the exact text between the `(` and `)`.
	 */
	href?: string;

	/**
	 * The image alt text. Present only on `image` tokens.
	 * Mirrors `content` (both hold the alt string), provided for semantic clarity.
	 */
	alt?: string;

	/** Open-ended extra fields for custom inline rules to attach arbitrary data. */
	[key: string]: unknown;
}

// Customizability

/**
 * Parse-state context passed to each `CustomBlockRule.test` call.
 */
export interface BlockParseContext {
	/** Whether the scanner is currently inside an open code fence. */
	inCodeFence: boolean;
	/** The fence marker string currently open, e.g. `"```"`. Empty when not in a fence. */
	fenceMarker: string;
	/** The language string on the opening fence. Empty when not in a fence. */
	fenceLang: string;
	/** 0-based index of the line currently being classified. */
	lineIndex: number;
}

/**
 * A custom block-level rule.
 *
 * Tested in order **before** all built-in rules (except code fence body and
 * blank line checks, which always run first).
 *
 * @example
 * // Obsidian-style callout: "> [!NOTE] Title"
 * const calloutRule = {
 *   type: 'callout',
 *   test(line) {
 *     const m = line.match(/^>\s*\[!(\w+)\]\s*(.*)/);
 *     if (!m) return null;
 *     return { calloutType: m[1].toLowerCase(), title: m[2] };
 *   },
 *   contentStart(line) {
 *     return line.indexOf(']') + 2;
 *   },
 * };
 */
export interface CustomBlockRule {
	/**
	 * The type string assigned to matched blocks.
	 * Must not collide with any built-in `BlockType` value.
	 */
	type: string;

	/**
	 * Classify a raw line.
	 *
	 * @returns
	 *   `null | undefined | false` → rule does not match.
	 *   `true`                     → match with empty meta `{}`.
	 *   A `BlockMeta` object       → match with that meta.
	 */
	test(line: string, context: BlockParseContext): BlockMeta | boolean | null | undefined;

	/**
	 * If `true`, the inline tokenizer will not run on blocks of this type.
	 * Defaults to `false`.
	 */
	opaque?: boolean;

	/**
	 * Returns the byte offset where inline content begins in the raw line.
	 * Only called when `opaque` is `false` (the default).
	 * Defaults to `() => 0` when omitted.
	 */
	contentStart?(line: string, meta: BlockMeta): number;
}

/**
 * Options controlling which block-level constructs the parser recognises.
 * All built-in features default to **enabled**.
 *
 * @example
 * createParser({
 *   block: {
 *     codeFence: { chars: ['`'] }, // backtick-only fences
 *     blockquote: false,           // no blockquotes
 *     custom: [calloutRule],
 *   },
 * });
 */
export interface BlockParserOptions {
	/** Enable ATX headings. Default: `true`. */
	heading?: boolean;
	/**
	 * Enable fenced code blocks.
	 * - `false` — disable entirely.
	 * - `{ chars }` — customise which characters may open a fence.
	 *   Default chars: `['`', '~']`. Example: `{ chars: ['`'] }` for backtick-only.
	 */
	codeFence?: boolean | { chars?: string[] };
	/** Enable blockquotes. Default: `true`. */
	blockquote?: boolean;
	/** Enable ordered and unordered list items. Default: `true`. */
	list?: boolean;
	/** Enable thematic breaks (`---`, `***`, `___`). Default: `true`. */
	hr?: boolean;
	/**
	 * Custom block rules, tested in order before all built-in rules.
	 * First rule whose `test` returns a non-falsy value claims the line.
	 */
	custom?: CustomBlockRule[];
}

// ---------------------------------------------------------------------------
// Parser customization — inline level
// ---------------------------------------------------------------------------

/**
 * A custom inline rule inserted into the scanner's main loop.
 *
 * `scan` is called at every character position before any built-in handler.
 * Returning a token claims the characters and advances the scanner; returning
 * `null` passes control to the next rule.
 *
 * @example
 * // ==highlight== syntax
 * const highlightRule = {
 *   type: 'highlight',
 *   scan(raw, i) {
 *     if (!raw.startsWith('==', i)) return null;
 *     const close = raw.indexOf('==', i + 2);
 *     if (close === -1) return null;
 *     return { type: 'highlight', raw: raw.slice(i, close + 2),
 *              content: raw.slice(i + 2, close), start: i, end: close + 2 };
 *   },
 * };
 *
 * @example
 * // @mention syntax
 * const mentionRule = {
 *   type: 'mention',
 *   scan(raw, i) {
 *     if (raw[i] !== '@') return null;
 *     const m = raw.slice(i).match(/^@([\w-]+)/);
 *     if (!m) return null;
 *     return { type: 'mention', raw: m[0], content: m[1],
 *              start: i, end: i + m[0].length };
 *   },
 * };
 */
export interface CustomInlineRule {
	/** The type string for matched tokens. Avoid colliding with `InlineTokenType`. */
	type: string;

	/**
	 * Attempt to match a token at position `i`.
	 *
	 * Contract:
	 * - Must not mutate `raw`.
	 * - If a token is returned: `token.start === i` and `raw.slice(token.start, token.end) === token.raw`.
	 *
	 * @param raw The full raw line string (including any block-level prefix).
	 * @param i   Current scanner position (0-based byte offset).
	 */
	scan(raw: string, i: number): InlineToken | null;
}

/**
 * Options controlling which inline constructs the tokenizer recognises.
 * All built-in features default to **enabled**.
 *
 * @example
 * createParser({
 *   inline: {
 *     image: false,
 *     strike: { delimiter: '~' }, // single-tilde strike
 *     custom: [highlightRule, mentionRule],
 *   },
 * });
 */
export interface InlineParserOptions {
	/** Enable backslash escapes. Default: `true`. */
	escape?: boolean;
	/** Enable inline code. Default: `true`. */
	code?: boolean;
	/**
	 * Enable strikethrough.
	 * - `false` — disable.
	 * - `{ delimiter }` — customise the delimiter string. Default: `'~~'`.
	 */
	strike?: boolean | { delimiter?: string };
	/** Enable bold (`**` / `__`). Default: `true`. */
	bold?: boolean;
	/** Enable italic (`*` / `_`). Default: `true`. */
	italic?: boolean;
	/** Enable links. Default: `true`. */
	link?: boolean;
	/** Enable images. Default: `true`. */
	image?: boolean;
	/**
	 * Custom inline rules, tested in order at each scanner position before
	 * any built-in handler. First rule returning a non-null token wins.
	 */
	custom?: CustomInlineRule[];
}

// ---------------------------------------------------------------------------
// Combined parser options and Parser interface
// ---------------------------------------------------------------------------

/** Top-level options object accepted by `createParser`. */
export interface ParserOptions {
	/** Options for the block-level parser. */
	block?: BlockParserOptions;
	/** Options for the inline tokenizer. */
	inline?: InlineParserOptions;
}

/**
 * A configured parser instance returned by `createParser`.
 * All methods reflect the options the instance was created with.
 */
export interface Parser {
	/** Parse a full markdown string into an array of Block objects (one per source line). */
	parseBlocks(raw: string): Block[];

	/**
	 * Returns the byte offset within `block.raw` where inline content begins.
	 * Handles custom block types (via their `contentStart` function) in addition
	 * to all built-in types.
	 */
	getBlockContentStart(block: Block): number;

	/**
	 * Returns the portion of `block.raw` after the block-level syntax prefix.
	 * Equivalent to `block.raw.slice(parser.getBlockContentStart(block))`.
	 */
	getBlockInlineRaw(block: Block): string;

	/** Serialize an array of blocks to a raw markdown string (joins `raw` fields with `\n`). */
	serializeBlocks(blocks: Block[]): string;

	/**
	 * Tokenize a raw line string into inline tokens.
	 * @param raw          The full raw line string.
	 * @param contentStart Byte offset to begin scanning. Defaults to `0`.
	 */
	tokenizeInline(raw: string, contentStart?: number): InlineToken[];

	/**
	 * Tokenize the inline content of a Block, computing `contentStart` automatically.
	 * Returns `[]` for opaque blocks (code fences, HR, custom rules with `opaque: true`).
	 */
	tokenizeBlock(block: Block): InlineToken[];

	/** The options this parser was created with. */
	readonly options: ParserOptions;
}
