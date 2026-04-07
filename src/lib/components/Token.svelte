<script module lang="ts">
	export type CustomNodesSnippet = Snippet<[{ node: CustomBlockNode | CustomInlineNode; children: Snippet }]>;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { AnyNode, CustomBlockNode, CustomInlineNode } from '$lib/parser';
	import Self from './Token.svelte';

	const {
		node,
		customNodes = customPassthrough,
	}: {
		node: AnyNode;
		customNodes?: CustomNodesSnippet;
	} = $props();
</script>

{#snippet customPassthrough({
	children,
}: {
	node: CustomBlockNode | CustomInlineNode;
	children: Snippet;
})}
	{@render children()}
{/snippet}

{#snippet children()}
	{#each node.children as child, i (`${child.type}-${i}`)}
		<Self node={child} />
	{/each}
{/snippet}

<!-- Block Nodes -->
{#if node.type == 'document'}
	{@render children()}
{:else if node.type == 'blockquote'}
	<blockquote>{@render children()}</blockquote>
{:else if node.type == 'list'}
	<ul>{@render children()}</ul>
{:else if node.type == 'list_item'}
	<li>{@render children()}</li>
{:else if node.type == 'heading'}
	<svelte:element this={`h${node.level}`}>{@render children()}</svelte:element>
{:else if node.type == 'paragraph'}
	<p>{@render children()}</p>
{:else if node.type == 'code_block'}
	<!--TODO: handle syntax highlighting  -->
	<pre><code>{node.value}</code></pre>
{:else if node.type == 'thematic_break'}
	<hr />

	<!-- Inline Nodes -->
{:else if node.type == 'text'}
	{node.value}
{:else if node.type == 'soft_break'}
	<br />
{:else if node.type == 'bold'}
	<b>{@render children()}</b>
{:else if node.type == 'italic'}
	<i>{@render children()}</i>
{:else if node.type == 'inline_code'}
	<code>{node.value}</code>
{:else if node.type == 'strike'}
	<s>{@render children()}</s>
{:else if node.type == 'link'}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
	<a href={node.href} target="_blank" rel="noopener noreferrer">{@render children()}</a>
{:else if node.type == 'image'}
	<img src={node.href} alt={node.alt} />
{:else if node.type == 'escape'}
	<span>{@render children()}</span>
{:else}
	{@render customNodes({ node, children })}
{/if}
