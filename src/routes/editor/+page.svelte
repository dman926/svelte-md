<script lang="ts">
	import { untrack } from 'svelte';
	import { createParser, MarkdownEditor } from '$lib';
	import { fade } from 'svelte/transition';

	const { data } = $props();

	let dirty = $state(false);
	let value = $state(untrack(() => data.content));

	let softBreak = $state(false);
	const parser = $derived(createParser({ inline: { softBreaks: softBreak ? 'space' : 'break' } }));
</script>

<div class="header">
	<h2>Editor</h2>
	<label>
		<input type="checkbox" bind:checked={softBreak} />
		Soft Breaks
	</label>
</div>
<form method="POST">
	<div class="md-input">
		<!-- TODO: does not accept a "name" prop nor has the capability to do so -->
		<MarkdownEditor
			bind:value
			{parser}
			oninput={() => {
				if (!dirty) dirty = true;
			}}
			placeholder="Type markdown…"
			debug
		/>
	</div>
	{#if dirty}
		<button type="submit" in:fade>Save</button>
	{:else}
		<button
			type="button"
			disabled
			style="visibility: hidden;"
			aria-label="Purposefully hidden button for spacing. Don't use. Doesn't do anything">a</button
		>
	{/if}
</form>

<h2>Raw</h2>
<pre>{value}</pre>

<style>
	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	pre {
		white-space: pre;
		overflow-x: auto;
		border: 1px solid black;
		padding: 0.25rem 0.5rem;
		min-height: 2.5em;
		border-radius: 1em;
	}

	button {
		display: block;
		margin-left: auto;
	}

	.md-input {
		border: 1px solid black;
		border-radius: 1em;
		padding: 0.25rem 0.5rem;
	}
</style>
