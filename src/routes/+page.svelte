<script lang="ts">
	import { defaultParser, MarkdownRenderer } from '$lib';

	let { data } = $props();

	const parsed = $derived(defaultParser.parse(data.content));
</script>

<h2>Renderer</h2>
<div class="md-input">
	<MarkdownRenderer {parsed} debug />
</div>

<h2>Parsed</h2>
<pre>{JSON.stringify(parsed, (key, value) => (key == 'parent' ? null : value), 2)}</pre>

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
