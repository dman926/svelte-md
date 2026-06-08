<script lang="ts">
	import type { CodeHighlighter } from '$lib/parser';

	let {
		code,
		lang,
		codeHighlighter,
	}: {
		code: string;
		lang: string;
		codeHighlighter: CodeHighlighter;
	} = $props();
	let html = $state<string | null>(null);

	// Reactively trigger highlight whenever code or lang changes
	$effect(() => {
		let active = true;
    const res = codeHighlighter(code, lang);
		if (typeof res == 'string') {
      html = res;
    } else {
      res.then((result) => {
				console.log({result})
        if (active) html = result;
      });
      return () => {
        active = false;
      };
    }
	});
</script>

{#if html}
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html html}
{:else}
	<pre><code>{code}</code></pre>
{/if}
