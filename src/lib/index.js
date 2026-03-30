/**
 * svelte-md-input — public API
 *
 * ## Quick start
 *
 * ```svelte
 * <script>
 *   import { MarkdownInput } from 'svelte-md-input';
 *   let value = $state('Hello **world**');
 * </script>
 *
 * <MarkdownInput bind:value placeholder="Type markdown…" />
 * ```
 *
 * ## Custom parser
 *
 * ```js
 * import { createParser, MarkdownInput } from 'svelte-md-input';
 *
 * const parser = createParser({
 *   block:  { blockquote: false, custom: [calloutRule] },
 *   inline: { image: false, custom: [mentionRule] },
 * });
 * ```
 *
 * ## Custom rendering
 *
 * ```svelte
 * <MarkdownInput bind:value>
 *   {#snippet tokenSnippet(token)}
 *     {#if token.type === 'mention'}
 *       <span class="mention" data-md-token={token.start}>@{token.content}</span>
 *     {:else}
 *       <!-- fall through to MarkdownLine for built-in types -->
 *     {/if}
 *   {/snippet}
 * </MarkdownInput>
 * ```
 */

// ── Components ────────────────────────────────────────────────────────────────

export { default as MarkdownInput } from './components/MarkdownInput.svelte';
export { default as MarkdownLine } from './components/MarkdownLine.svelte';

// ── Parser ────────────────────────────────────────────────────────────────────

export { createParser, defaultParser } from './parser';
export { createBlockParser } from './parser/block.js';
export { createInlineParser } from './parser/inline.js';

// ── Cursor ────────────────────────────────────────────────────────────────────

export {
	captureSelection,
	restoreSelection,
	resolvePointToRange,
	getTokenPrefixLen,
	rawColToDomOffset,
	domOffsetToRawCol,
	findTokenAtRawCol,
	findTokenByStart,
	makeCollapsedSelection,
	makeSelection,
	pointsEqual,
	clampPoint,
	LINE_ATTR,
	TOKEN_ATTR,
} from './cursor/index.js';

// ── DOM utilities ─────────────────────────────────────────────────────────────

export { serializeLine, serializeEditor, buildContentStarts } from './dom/serialize.js';
export { patchLine, patchEditor, createTokenElement } from './dom/patcher.js';
