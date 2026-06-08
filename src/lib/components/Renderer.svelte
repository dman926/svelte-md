<script lang="ts">
	import { defaultParser, type Parser, type Document, type CodeHighlighter } from '$lib/parser';
	import { serializeJSON } from '$lib/parser/utils';
	import Token, { type CustomNodesSnippet } from './Token.svelte';

	const {
		debug,
		codeHighlighter,
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
	) &
		Partial<{
			customNodes: CustomNodesSnippet;
			/**
			 * WARNING: The highlighter is rendered as raw HTML, which can be dangerous.
			 * Be VERY careful about how it is used
			 */
			codeHighlighter: CodeHighlighter;
			debug: boolean;
		}> = $props();

	const parsed = $derived(
		'parsed' in props ? props.parsed : (props.parser ?? defaultParser).parse(props.value),
	);

	$effect(() => {
		if (debug) console.log('Parsed AST:', serializeJSON(parsed));
	});
</script>

<Token node={parsed} version={parsed.version} {customNodes} {codeHighlighter} />
