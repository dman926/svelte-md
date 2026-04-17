// ---------------------------------------------------------------------------
// Source positions
// ---------------------------------------------------------------------------

export interface Position {
	/** 0-based line number within the document. */
	line: number;
	/** Byte offset from the start of the full source string. */
	offset: number;
}

export interface NodeRange {
	start: Position;
	end: Position;
}

export interface TextChunk extends Position {
	text: string;
}

// ---------------------------------------------------------------------------
// Base nodes
// ---------------------------------------------------------------------------

export interface BaseBlock {
	raw: string;
	range: NodeRange;
	parent?: AnyNode;
}

export interface ParentBlock<ChildType extends AnyNode = AnyNode> extends BaseBlock {
	children: ChildType[];
}

export interface LeafBlock extends BaseBlock {
	children?: never;
}

// TODO: I want to allow any string that's not a built-in
// but Typescript is a pain in the ass and breaks when trying to do so
export type CustomNodeName = `custom:${string}`;

// ---------------------------------------------------------------------------
// Block nodes
// ---------------------------------------------------------------------------

export interface Document extends ParentBlock<BlockNode> {
	type: 'document';
}

export interface Blockquote extends ParentBlock<BlockNode> {
	type: 'blockquote';
}

export interface List extends ParentBlock<ListItem> {
	type: 'list';
	ordered: boolean;
	start: number;
	tight: boolean;
}

export interface ListItem extends ParentBlock<BlockNode> {
	type: 'list_item';
	marker: string;
}

export interface Heading extends ParentBlock<InlineNode> {
	type: 'heading';
	level: number;
	chunks: TextChunk[];
}

export interface Paragraph extends ParentBlock<InlineNode> {
	type: 'paragraph';
	chunks: TextChunk[];
}

export interface CodeBlock extends LeafBlock {
	type: 'code_block';
	lang: string;
	fenceChar: string;
	value: string;
}

export interface ThematicBreak extends LeafBlock {
	type: 'thematic_break';
}

export interface BlankLine extends LeafBlock {
	type: 'blank_line';
}

export interface CustomBlockNode extends BaseBlock {
	type: CustomNodeName;
	children?: BlockNode[];
	[key: string]: unknown;
}

export type BlockNode =
	| Document
	| Blockquote
	| List
	| ListItem
	| Heading
	| Paragraph
	| CodeBlock
	| ThematicBreak
	| BlankLine
	| CustomBlockNode;

// ---------------------------------------------------------------------------
// Base inline nodes
// ---------------------------------------------------------------------------

export interface BaseInline {
	raw: string;
	range: NodeRange;
}

export interface ParentInline extends BaseInline {
	children: InlineNode[];
}

export interface LeafInline extends BaseInline {
	children?: never;
}

// ---------------------------------------------------------------------------
// Inline nodes — all carry an InlineRange for cursor mapping
// ---------------------------------------------------------------------------

export interface TextNode extends LeafInline {
	type: 'text';
	value: string;
}

export interface SoftBreak extends LeafInline {
	type: 'soft_break';
}

export interface Bold extends ParentInline {
	type: 'bold';
}

export interface Italic extends ParentInline {
	type: 'italic';
}

export interface Hightlight extends ParentInline {
	type: 'highlight';
}

export interface InlineCode extends LeafInline {
	type: 'inline_code';
	value: string;
}

export interface Strike extends ParentInline {
	type: 'strike';
}

export interface LinkNode extends ParentInline {
	type: 'link';
	href: string;
}

export interface ImageNode extends LeafInline {
	type: 'image';
	href: string;
	alt: string;
}

export interface EscapeNode extends LeafInline {
	type: 'escape';
	char: string;
}

export interface CustomInlineNode extends BaseInline {
	type: CustomNodeName;
	children?: AnyNode[];
	[key: string]: unknown;
}

export type InlineNode =
	| TextNode
	| SoftBreak
	| Bold
	| Italic
	| Hightlight
	| InlineCode
	| Strike
	| LinkNode
	| ImageNode
	| EscapeNode
	| CustomInlineNode;

// Helper Union
export type AnyNode = BlockNode | InlineNode;

// ---------------------------------------------------------------------------
// Block rule plugin interface
// ---------------------------------------------------------------------------

export interface BlockRuleContext {
	lines: string[];
	lineIndex: number;
	/** Byte offset of the start of `lines[lineIndex]` in the full source. */
	lineOffset: number;
	/** All block rules of the parser */
	rules: BlockRule[];
}

export interface BlockStartResult {
	node: BlockNode;
	/** Remaining content after the opening marker, fed to inner-block classification. */
	remainder?: string;
	remainderOffset?: number;
}

export interface BlockContinueResult {
	remainder: string;
	remainderOffset: number;
	/**
	 * Set to `true` by leaf rules (e.g. code_block) when the current line is
	 * the closing marker and has been fully consumed. Tells the parse loop to
	 * close this block AND skip Phase 3 (block-start detection) for this line.
	 */
	close?: boolean;
}

export interface BlockRule {
	name: string;
	/**
	 * Ascending priority. Built-ins: break=10, heading=20, code=30, bq=40, list=50, para=999.
	 * @default 50
	 */
	priority?: number;
	isContainer: boolean;
	tryStart(line: string, context: BlockRuleContext): BlockStartResult | null;
	tryContinue(line: string, node: BlockNode, context: BlockRuleContext): BlockContinueResult | null;
	finalize?(node: BlockNode): void;
}

// ---------------------------------------------------------------------------
// Inline rule plugin interface
// ---------------------------------------------------------------------------

export interface InlineRule {
	name: string;
	priority?: number;
	/**
	 * Attempt to match an inline node at `pos`.
	 * On success, return an InlineNode extended with `_end: number`
	 * (exclusive end position) so the scanner knows how far to advance.
	 * The node MUST include a populated `range` field.
	 */
	scan(
		raw: string,
		pos: number,
		end: number,
		getRange: (start: number, end: number) => NodeRange,
	): (InlineNode & { _end: number }) | null;
}

// ---------------------------------------------------------------------------
// Parser options
// ---------------------------------------------------------------------------

export interface BlockParserOptions {
	rules?: BlockRule[];
	disableRules?: string[];
}

export interface InlineParserOptions {
	rules?: InlineRule[];
	disableRules?: string[];
	/**
	 * How single-newline soft breaks inside paragraphs are represented.
	 * - `'space'` - collapsed to a space in the text value.
	 * - `'break'` - emitted as a `soft_break` node.
	 * @default 'space'
	 */
	softBreaks?: 'space' | 'break';
}

export interface ParserOptions {
	block?: BlockParserOptions;
	inline?: InlineParserOptions;
}

// ---------------------------------------------------------------------------
// Edit range for incremental updates
// ---------------------------------------------------------------------------

/**
 * Describes a text edit as a line-level replacement.
 *
 * - `startLine` / `endLine` — the 0-based line range in the OLD source that
 *   was replaced (inclusive on both ends).
 * - `deltaLines` — how many lines were added (positive) or removed (negative)
 *   by the edit. `deltaLines = newLineCount - (endLine - startLine + 1)`.
 */
export interface EditRange {
	startLine: number;
	endLine: number;
	deltaLines: number;
}

// ---------------------------------------------------------------------------
// Public Parser interface
// ---------------------------------------------------------------------------

export interface Parser {
	/** Parse a markdown source string into a full AST. */
	parse(source: string): Document;

	/**
	 * Incrementally re-parse after an edit, reusing unchanged parts of `oldDoc`.
	 *
	 * The returned Document is a new object, but nodes outside the affected
	 * region are the same references as in `oldDoc` (safe to cache).
	 *
	 * @param oldDoc    The previously parsed Document.
	 * @param newSource The new full source string after the edit.
	 * @param edit      The line range that changed (see `EditRange`).
	 */
	update(oldDoc: Document, newSource: string, edit: EditRange): Document;

	readonly options: ParserOptions;
}
