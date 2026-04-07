/**
 * @dman926/svelte-md — public API
 *
 * ## Quick start
 *
 * ```svelte
 * <script>
 *   import { MarkdownRenderer } from '@dman926/svelte-md';
 * </script>
 *
 * <MarkdownRenderer value="Hello **world**" />
 * ```
 * 
 * ```svelte
 * <script>
 *   import { MarkdownEditor } from '@dman926/svelte-md';
 *   let value = $state('Hello **world**');
 * </script>
 *
 * <MarkdownEditor bind:value placeholder="Type markdown…" />
 * ```
 *
 * ## Custom parser
 *
 * ```js
 * import { createParser, MarkdownEditor } from '@dman926/svelte-md';
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
 * <MarkdownEditor bind:value>
 *   {#snippet tokenSnippet(token)}
 *     {#if token.type === 'mention'}
 *       <span class="mention" data-md-token={token.start}>@{token.content}</span>
 *     {:else}
 *       <!-- fall through to MarkdownLine for built-in types -->
 *     {/if}
 *   {/snippet}
 * </MarkdownEditor>
 * ```
 */

// ── Components ────────────────────────────────────────────────────────────────

export { default as MarkdownEditor } from './components/Editor.svelte';
export { default as MarkdownRenderer } from './components/Renderer.svelte';

// ── Parser ────────────────────────────────────────────────────────────────────

export { createParser, defaultParser } from './parser';
export { createBlockParser } from './parser/block.js';
export { createInlineParser } from './parser/inline.js';

// ── Cursor ────────────────────────────────────────────────────────────────────

// ── DOM utilities ─────────────────────────────────────────────────────────────
