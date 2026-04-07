<script lang="ts">
	// import { MarkdownRenderer } from '$lib';
	import MarkdownRenderer from '$lib/components/new/Renderer.svelte';

	let { data } = $props();
</script>

<h2>Renderer</h2>
<div class="md-input">
	<MarkdownRenderer value={data.content} debug />
</div>

<h2>Raw</h2>
<pre>{data.content}</pre>

<style>
	.md-input {
		border: 1px solid black;
		border-radius: 1em;
		padding: 0.25rem 0.5rem;
	}

	pre {
		white-space: pre;
		overflow-x: auto;
		min-height: 2.5em;
		padding: 0.25rem 0.5rem;
		border: 1px solid black;
		border-radius: 1em;
	}
</style>
