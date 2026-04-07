<script lang="ts">
	import { untrack } from 'svelte';
	import { defaultParser, type Parser } from '$lib/parser';
	import Renderer from './Renderer.svelte';
	import type { CustomNodesSnippet } from './Token.svelte';

	let {
		value = $bindable(''),
		customNodes,
		parser = defaultParser,
		placeholder,
		disabled,
		readonly,
		spellcheck,
		onchange,
		oninput,
		onsubmit,
		debug,
	}: Partial<{
		value: string;
		customNodes: CustomNodesSnippet;
		parser: Parser;
		placeholder: string;
		disabled: boolean;
		readonly: boolean;
		spellcheck: boolean;
		onchange: (value: string) => void;
		oninput: (value: string) => void;
		onsubmit: (value: string) => void;
		debug: boolean;
	}> = $props();

	// TODO: instead of calling parser.parse on every keystroke, I want to use parser.update to incrementally update the AST.
	let parsed = $state(untrack(() => parser.parse(value)));
</script>

<div
	role="textbox"
	tabindex="0"
	contenteditable={!(disabled || readonly)}
	{spellcheck}
	autocapitalize="off"
	aria-multiline="true"
	aria-label={placeholder}
	aria-disabled={disabled}
	aria-readonly={readonly}
>
	<Renderer {parsed} {debug} {customNodes} />
</div>
