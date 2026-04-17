<script lang="ts">
	import { defaultParser, type Parser, type Document } from '$lib/parser';
	import Token, { type CustomNodesSnippet } from './Token.svelte';

	const {
		debug,
		customNodes,
		...props
	}: (
		| {
				/** The raw markdown string */
				value: string;
				/**
				 * Override the {@link defaultParser|default parser}
				 */
				parser?: Parser;
		  }
		| {
				/**
				 * Provide a pre-parsed Document. Should only be used by the Editor.
				 * Consider providing `parser` with your value instead
				 */
				parsed: Document;
		  }
	) & {
		customNodes?: CustomNodesSnippet;
		debug?: boolean;
	} = $props();

	const parsed = $derived(
		'parsed' in props ? props.parsed : (props.parser ?? defaultParser).parse(props.value),
	);

	$effect(() => {
		const p = parsed;
		if (debug) {
			console.log('Parsed AST:', p);
		}
	});
</script>

<Token node={parsed} {customNodes} />
