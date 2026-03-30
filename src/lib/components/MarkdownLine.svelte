<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Block, InlineToken } from '../parser/types';

	let {
		block,
		tokens = [],
		lineTag = 'div',
		lineClass = '',
		tokenSnippet,
		opaqueSnippet,
	}: {
		block: Block;
		tokens?: InlineToken[];
		/** @default 'div' */
		lineTag?: string;
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

	let isOpaque = $derived(OPAQUE_TYPES.has(block.type));
	let isBlank = $derived(block.type === 'blank');
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
  | `bold_italic`| `<strong>`    | contains `<em>` child              |
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
	{#if isBlank}
		<!-- Blank line: browser needs a <br> to give the line a height and allow
         the cursor to sit on it. No data-md-token elements here. -->
		<br />
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
			{#if tokenSnippet}
				{@render tokenSnippet(token)}
			{:else}
				<!--
          Default token rendering.
          data-md-token is required by the cursor module.
          data-md-type is a CSS styling hook.
        -->
				{#if token.type === 'bold'}
					<strong data-md-token={token.start} data-md-type="bold">{token.content}</strong>
				{:else if token.type === 'italic'}
					<em data-md-token={token.start} data-md-type="italic">{token.content}</em>
				{:else if token.type === 'bold_italic'}
					<!-- The outer element carries data-md-token; the cursor module's
               firstTextNode() walker finds the text inside the <em>. -->
					<strong data-md-token={token.start} data-md-type="bold_italic"
						><em>{token.content}</em></strong
					>
				{:else if token.type === 'code'}
					<code data-md-token={token.start} data-md-type="code">{token.content}</code>
				{:else if token.type === 'strike'}
					<s data-md-token={token.start} data-md-type="strike">{token.content}</s>
				{:else if token.type === 'link'}
					<!-- Rendered as <span> rather than <a> so the link is not
               navigable while editing. Consumers can use tokenSnippet
               to render <a href={token.href}> for display contexts. -->
					<span data-md-token={token.start} data-md-type="link">{token.content}</span>
				{:else if token.type === 'image'}
					<!-- Alt text only; image is not displayed inline in the editor. -->
					<span data-md-token={token.start} data-md-type="image">{token.content}</span>
				{:else if token.type === 'escape'}
					<span data-md-token={token.start} data-md-type="escape">{token.content}</span>
				{:else}
					<!-- Custom or unknown token type — plain <span> with data-md-type
               set to the token's type string for CSS targeting. -->
					<span data-md-token={token.start} data-md-type={token.type}>{token.content}</span>
				{/if}
			{/if}
		{/each}
	{/if}
</svelte:element>
