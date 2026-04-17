<script module lang="ts">
	export type CustomNodesSnippet = Snippet<
		[
			{
				/** The Token that wants to render */
				node: CustomBlockNode | CustomInlineNode;
				/** The child nodes to render. Do not need to call for Leaf Tokens */
				children: Snippet;
				/** Must be spread on the rendered element for editing to work properly */
				dataProps: {
					'data-md-v': number;
					'data-md-start-line': number;
					'data-md-start-offset': number;
					'data-md-end-line': number;
					'data-md-end-offset': number;
				};
			},
		]
	>;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { AnyNode, CustomBlockNode, CustomInlineNode } from '$lib/parser';
	import Self from './Token.svelte';

	const {
		node,
		version,
		customNodes = customPassthrough,
	}: {
		node: AnyNode;
		/** Just set to node.version. Wacky work-around to get data-props to update */
		version: number;
		customNodes?: CustomNodesSnippet;
	} = $props();

	const dataProps = $derived({
		'data-md-v': version,
		'data-md-start-line': node.range.start.line,
		'data-md-start-offset': node.range.start.offset,
		'data-md-end-line': node.range.end.line,
		'data-md-end-offset': node.range.end.offset,
	});
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
	{#each node.children as child (child.id)}
		<Self node={child} version={node.version} />
	{/each}
{/snippet}

<!-- Block Nodes -->
{#if node.type == 'document'}
	{@render children()}
{:else if node.type == 'blockquote'}
	<blockquote {...dataProps}>{@render children()}</blockquote>
{:else if node.type == 'list'}
	<svelte:element this={node.ordered ? 'ol' : 'ul'} {...dataProps}>
		{@render children()}
	</svelte:element>
{:else if node.type == 'list_item'}
	<li {...dataProps}>{@render children()}</li>
{:else if node.type == 'heading'}
	<svelte:element this={`h${node.level}`} {...dataProps}>{@render children()}</svelte:element>
{:else if node.type == 'paragraph'}
	{@const tightListItemEl =
		node.parent?.type == 'list_item' &&
		node.parent.parent?.type == 'list' &&
		node.parent.parent.tight &&
		'span'}
	<svelte:element this={tightListItemEl || 'p'} {...dataProps}>
		{@render children()}
	</svelte:element>
{:else if node.type == 'code_block'}
	<!--TODO: handle syntax highlighting  -->
	<pre {...dataProps}><code>{node.value}</code></pre>
{:else if node.type == 'thematic_break'}
	<hr {...dataProps} />
{:else if node.type == 'blank_line'}
	<p {...dataProps}><br /></p>

	<!-- Inline Nodes -->
{:else if node.type == 'text'}
	<span {...dataProps}>{node.value}</span>
{:else if node.type == 'soft_break'}
	<br {...dataProps} />
{:else if node.type == 'bold'}
	<b {...dataProps}>{@render children()}</b>
{:else if node.type == 'italic'}
	<i {...dataProps}>{@render children()}</i>
{:else if node.type == 'highlight'}
	<mark {...dataProps}>{@render children()}</mark>
{:else if node.type == 'inline_code'}
	<code {...dataProps}>{node.value}</code>
{:else if node.type == 'strike'}
	<s {...dataProps}>{@render children()}</s>
{:else if node.type == 'link'}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
	<a href={node.href} target="_blank" rel="noopener noreferrer" {...dataProps}>
		{@render children()}
	</a>
{:else if node.type == 'image'}
	<img src={node.href} alt={node.alt} {...dataProps} />
{:else if node.type == 'escape'}
	<span {...dataProps}>{@render children()}</span>

	<!-- Custom Nodes -->
{:else}
	{@render customNodes({ node, children, dataProps })}
{/if}
