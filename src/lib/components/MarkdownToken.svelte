<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { InlineToken } from '$lib/parser';
	import Self from './MarkdownToken.svelte';

	const { token, tokenSnippet }: { token: InlineToken; tokenSnippet?: Snippet<[InlineToken]> } =
		$props();
</script>

{#snippet content()}
  {#if token.children?.length}
    {#each token.children as child (child.start)}
      <Self token={child} {tokenSnippet} />
    {/each}
  {:else}
    {token.content}
  {/if}
{/snippet}

{#if tokenSnippet}
	{@render tokenSnippet(token)}
{:else}
	<!--
          Default token rendering.
          data-md-token is required by the cursor module.
          data-md-type is a CSS styling hook.
        -->
	{#if token.type == 'bold'}
		<b data-md-token={token.start} data-md-type="bold">{@render content()}</b>
	{:else if token.type == 'italic'}
		<i data-md-token={token.start} data-md-type="italic">{@render content()}</i>
	{:else if token.type == 'code'}
		<code data-md-token={token.start} data-md-type="code">{@render content()}</code>
	{:else if token.type == 'strike'}
		<s data-md-token={token.start} data-md-type="strike">{@render content()}</s>
	{:else if token.type == 'link'}
		<!-- Rendered as <span> rather than <a> so the link is not
               navigable while editing. Consumers can use tokenSnippet
               to render <a href={token.href}> for display contexts. -->
		<span data-md-token={token.start} data-md-type="link">{@render content()}</span>
	{:else if token.type == 'image'}
		<!-- Alt text only; image is not displayed inline in the editor. -->
		<span data-md-token={token.start} data-md-type="image">{@render content()}</span>
	{:else if token.type == 'escape'}
		<span data-md-token={token.start} data-md-type="escape">{@render content()}</span>
	{:else}
		<!-- Custom or unknown token type — plain <span> with data-md-type
               set to the token's type string for CSS targeting. -->
		<span data-md-token={token.start} data-md-type={token.type}>{@render content()}</span>
	{/if}
{/if}
