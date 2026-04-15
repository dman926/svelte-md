<script lang="ts">
	import { createParser, MarkdownRenderer } from '$lib';

	let { data } = $props();

	let softBreak = $state(false);
	const parser = $derived(createParser({ inline: { softBreaks: softBreak ? 'space' : 'break' } }));

	const parsed = $derived(parser.parse(data.content));
</script>

<div class="header">
	<h2>Renderer</h2>
	<label>
		<input type="checkbox" bind:checked={softBreak} />
		Soft Breaks
	</label>
</div>
<div class="md-input">
	<MarkdownRenderer {parser} value={data.content} debug />
</div>

<h2>Parsed</h2>
<pre>{JSON.stringify(parsed, (key, value) => (key == 'parent' ? null : value), 2)}</pre>

<h2>Raw</h2>
<pre>{data.content}</pre>

<style>
	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

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
