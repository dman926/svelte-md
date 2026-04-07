<script lang="ts">
	import { untrack } from 'svelte';
	import { defaultParser, type Parser } from '$lib/parser';
	import Renderer from './Renderer.svelte';

	let {
		value = $bindable(''),
		parser = defaultParser,
		disabled,
		readonly,
		spellcheck,
	}: {
		value: string;
		parser?: Parser;
		disabled?: boolean;
		readonly?: boolean;
		spellcheck?: boolean;
	} = $props();

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
	aria-disabled={disabled}
	aria-readonly={readonly}
>
	<Renderer {parsed} />
</div>
