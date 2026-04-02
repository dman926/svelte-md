<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Block, InlineToken } from '../parser/types';
	import MarkdownToken from './MarkdownToken.svelte';

	let {
		block,
		tokens = [],
		lineTag: givenLineTag,
		lineClass = '',
		tokenSnippet,
		opaqueSnippet,
	}: {
		block: Block;
		tokens?: InlineToken[];
		/** @default 'div' */
		lineTag?: string | ((block: Block) => string);
		lineClass?: string;
		tokenSnippet?: Snippet<[InlineToken]>;
		opaqueSnippet?: Snippet<[Block]>;
	} = $props();

	/**
	 * Whether this block should render its raw content verbatim, with no
	 * inline token wrappers. These lines must NOT contain `data-md-token`
	 * elements or the cursor module will mis-map positions.
	 */
	const OPAQUE_TYPES = new Set(['code_fence_open', 'code_fence_body', 'code_fence_close', 'hr']);
	const isOpaque = $derived(OPAQUE_TYPES.has(block.type));

	const lineTag = $derived.by(() => {
		if (typeof givenLineTag == 'string') return givenLineTag;
		switch (block.type) {
			case 'blockquote':
				return 'blockquote';
			case 'paragraph':
				return 'p';
			case 'heading':
				return `h${block.meta.level ?? 1}`;
			case 'list_item':
				return 'li';
			default:
				if (typeof givenLineTag == 'function') return givenLineTag(block);
				return 'div';
		}
	});
</script>

<!--@component
  MarkdownLine — renders a single parsed block as a line in the editor.
  
  This component is the **rendering primitive** of the library. It takes a
  `Block` and its `InlineToken[]` array and produces a DOM element carrying
  the cursor contract attributes (`data-md-line`, `data-md-token`).
  
  ## Customisation
  
  Two Svelte 5 snippets let you control rendering without forking the
  component:
  
  - **`tokenSnippet`** — override how a single inline token is rendered.
    Receives the token object. Must render exactly one root element with
    `data-md-token={token.start}` set, or the cursor system will break.
  
  - **`opaqueSnippet`** — override how opaque/blank blocks are rendered.
    Receives the block object. The root element should NOT contain any
    `data-md-token` elements.
  
  When neither snippet is provided, the default rendering is used:
  
  | Token type   | Element       | Notes                              |
  |--------------|---------------|------------------------------------|
  | `text`       | `<span>`      | plain text                         |
  | `bold`       | `<strong>`    |                                    |
  | `italic`     | `<em>`        |                                    |
  | `code`       | `<code>`      |                                    |
  | `strike`     | `<s>`         |                                    |
  | `link`       | `<span>`      | not `<a>` — in-editor, not navigation |
  | `image`      | `<span>`      | alt text only                      |
  | `escape`     | `<span>`      |                                    |
  | custom       | `<span>`      |                                    |
  
  ## Styling
  
  Zero CSS is applied by default. Use the `data-md-type` attribute on token
  elements and `data-md-block-type` on the line container for CSS selectors:
  
  ```css
  [data-md-block-type="heading"] { font-weight: bold; }
  [data-md-type="bold"]          { font-weight: bold; }
  [data-md-type="code"]          { font-family: monospace; }
  ``` 
-->

<!--
  The line container carries `data-md-line` so the cursor module can locate it.
  `data-md-block-type` is a CSS styling hook — it never affects cursor logic.
  Svelte's `{@const}` approach is used to set dynamic tags cleanly.
-->
<svelte:element
	this={lineTag}
	class={lineClass || undefined}
	data-md-line={block.lineIndex}
	data-md-block-type={block.type}
>
	{#if block.type == 'blank'}
		<br />
	{:else if block.type == 'hr'}
		<hr />
	{:else if isOpaque}
		<!-- Opaque block: raw content rendered as-is. The serializer reads back
         lineEl.textContent for these lines. -->
		{#if opaqueSnippet}
			{@render opaqueSnippet(block)}
		{:else}
			{block.raw}
		{/if}
	{:else}
		<!-- Tokenized block: each inline token gets its own wrapper element.
         Svelte's keyed #each reuses elements when token.start is stable,
         minimising DOM mutations on re-renders. -->
		{#each tokens as token (token.start)}
			<MarkdownToken {token} {tokenSnippet} />
		{/each}
	{/if}
</svelte:element>
