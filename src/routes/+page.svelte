<script lang="ts">
	import { MarkdownInput } from '$lib';

	let { data } = $props();
</script>

<h2>Renderer</h2>
<div class="md-input">
	<MarkdownInput value={data.content} placeholder="Type markdown…" readonly />
</div>

<h2>Raw</h2>
<pre>{data.content}</pre>

<style>
	.md-input {
		border: 1px solid black;
		border-radius: 1em;
	}

	pre {
		white-space: pre;
		overflow-x: auto;
		min-height: 2.5em;
		border: 1px solid black;
		border-radius: 1em;
	}
</style>
