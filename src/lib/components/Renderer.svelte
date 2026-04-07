<script lang="ts">
	import { defaultParser, type Parser, type Document } from '$lib/parser';
	import Token, { type CustomNodesSnippet } from './Token.svelte';

	const {
		debug,
		customNodes,
		...props
	}: ({ value: string; parser?: Parser } | { parsed: Document }) & {
		customNodes?: CustomNodesSnippet;
		debug?: boolean;
	} = $props();

	const parsed = $derived(
		'parsed' in props ? props.parsed : (props.parser ?? defaultParser).parse(props.value),
	);

	$effect(() => {
		if (debug) {
			console.log('Parsed AST:', parsed);
		}
	});
</script>

<Token node={parsed} {customNodes} />
