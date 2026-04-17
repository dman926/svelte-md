<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type { EventHandler } from 'svelte/elements';
	import { defaultParser, type EditRange, type Parser } from '$lib/parser';
	import { captureSelection, restoreSelection, type RawSelection } from './cursor';
	import type { CustomNodesSnippet } from './Token.svelte';
	import Renderer from './Renderer.svelte';

	let {
		ref: editorEl = $bindable(null),
		value = $bindable(''),
		customNodes,
		parser = defaultParser,
		submitOnEnter,
		placeholder,
		disabled,
		readonly,
		spellcheck,
		name,
		onchange,
		oninput,
		onsubmit,
		class: className,
		debug,
	}: Partial<{
		/** The editor root element */
		ref: HTMLDivElement | null;
		value: string;
		customNodes: CustomNodesSnippet;
		parser: Parser;
		submitOnEnter: boolean;
		placeholder: string;
		disabled: boolean;
		readonly: boolean;
		spellcheck: boolean;
		name: string;
		onchange: (value: string) => void;
		oninput: (value: string) => void;
		onsubmit: (value: string) => void;
		class: string;
		debug: boolean;
	}> = $props();

	let parsed = $state.raw(untrack(() => parser.parse(value)));
	/** True while an IME composition is in progress */
	let isComposing = $state(false);
	/** True while the editor has focus */
	let isFocused = $state(false);

	let savedCursor: RawSelection | null = null;

	// ---------------------------------------------------------------------------
	// External value sync
	// ---------------------------------------------------------------------------

	let init = $state(false);
	/**
	 * When the `value` or `parser` prop changes from outside while the editor is not focused,
	 * sync it to internal state. If the editor IS focused, we ignore external
	 * changes to avoid fighting with the user's in-progress editing.
	 */
	$effect(() => {
		const v = value;
		const p = parser;
		const i = untrack(() => init);
		if (i && untrack(() => !isFocused)) parsed = p.parse(v);
		else if (!i) init = true;
	});

	// ---------------------------------------------------------------------------
	// Helpers
	// ---------------------------------------------------------------------------

	const applyEdit = (
		cursor: RawSelection,
		insertText: string,
		deleteDir: 'none' | 'backward' | 'forward' = 'none',
	) => {
		let start = Math.min(cursor.anchor, cursor.focus);
		let end = Math.max(cursor.anchor, cursor.focus);

		if (start == end) {
			if (deleteDir == 'backward' && start > 0) start -= 1;
			else if (deleteDir == 'forward' && end < value.length) end += 1;
		}

		const nextSource = value.slice(0, start) + insertText + value.slice(end);

		// Calculate EditRange for incremental update
		const startLine = value.slice(0, start).split('\n').length - 1;
		const endLine = value.slice(0, end).split('\n').length - 1;
		const addedLines = insertText.split('\n').length - 1;
		const removedLines = endLine - startLine;

		const edit: EditRange = {
			startLine,
			endLine,
			deltaLines: addedLines - removedLines,
		};

		// Update model
		parsed = parser.update(parsed, nextSource, edit);
		value = nextSource;
		oninput?.(nextSource);

		return start + insertText.length;
	};

	const applyEditAndRestore = async (
		cursor: RawSelection,
		insertText: string,
		deleteDir: 'none' | 'backward' | 'forward' = 'none',
	) => {
		const newOffset = applyEdit(cursor, insertText, deleteDir);
		await tick();
		if (editorEl) {
			restoreSelection(
				editorEl,
				{ anchor: newOffset, focus: newOffset, isCollapsed: true },
				parsed,
			);
		}
	};

	// ---------------------------------------------------------------------------
	// Handlers
	// ---------------------------------------------------------------------------

	const handleBeforeInput: EventHandler<InputEvent, HTMLDivElement> = (e) => {
		if (disabled || readonly || isComposing || !editorEl) return;

		savedCursor = captureSelection(editorEl);
		if (!savedCursor) return;

		switch (e.inputType) {
			case 'insertText':
				if (e.data == null) break;
				e.preventDefault();
				applyEditAndRestore(savedCursor, e.data);
				break;

			case 'insertParagraph':
			case 'insertLineBreak':
				e.preventDefault();
				applyEditAndRestore(savedCursor, '\n');
				break;

			case 'deleteContentBackward':
			case 'deleteWordBackward':
				e.preventDefault();
				applyEditAndRestore(savedCursor, '', 'backward');
				break;

			case 'deleteContentForward':
			case 'deleteWordForward':
				e.preventDefault();
				applyEditAndRestore(savedCursor, '', 'forward');
				break;
		}
	};

	const handleInput = async () => {
		if (disabled || readonly || isComposing || !editorEl) return;

		// Fallback for things like Spellcheck or Drag & Drop that mutate DOM directly
		// We re-parse fully if the DOM gets out of sync because incremental
		// update requires precise EditRanges which browser-mutated DOM doesn't provide easily.
		const newRaw = editorEl.innerText; // Simple serialization
		if (newRaw == value) return;

		const cursor = captureSelection(editorEl);
		value = newRaw;
		parsed = parser.parse(value); // Full re-parse as fallback
		oninput?.(value);

		await tick();
		if (editorEl && cursor) restoreSelection(editorEl, cursor, parsed);
	};

	const handleCompositionStart = () => {
		isComposing = true;
		if (editorEl) savedCursor = captureSelection(editorEl);
	};

	const handleCompositionEnd = async () => {
		isComposing = false;
		if (!editorEl) return;

		// IME finished, treat the current DOM as the new source
		const newRaw = editorEl.innerText;
		parsed = parser.parse(newRaw);
		value = newRaw;
		oninput?.(value);

		await tick();
		if (editorEl && savedCursor) {
			// Restore to a calculated position or re-capture
			const current = captureSelection(editorEl);
			if (current) restoreSelection(editorEl, current, parsed);
		}
	};

	const handleKeydown = (e: KeyboardEvent) => {
		if (disabled || readonly || isComposing) return;

		if (e.key == 'Enter') {
			const isSubmit = (submitOnEnter && !e.shiftKey) || e.ctrlKey || e.metaKey;
			if (isSubmit) {
				e.preventDefault();
				onsubmit?.(value);
			}
		}
	};

	const handleFocus = () => {
		isFocused = true;
	};

	const handleBlur = () => {
		isFocused = false;
		onchange?.(value);
	};

	const handlePaste = (e: ClipboardEvent) => {
		if (disabled || readonly || !editorEl) return;
		e.preventDefault();

		const text = e.clipboardData?.getData('text/plain');
		if (!text) return;

		const cursor = captureSelection(editorEl);
		if (cursor) applyEditAndRestore(cursor, text);
	};
</script>

{#if name}
	<input type="hidden" {name} {value} />
{/if}
<div
	bind:this={editorEl}
	class={className}
	role="textbox"
	tabindex="0"
	contenteditable={!(disabled || readonly)}
	{spellcheck}
	autocapitalize="off"
	data-placeholder={placeholder || undefined}
	aria-multiline="true"
	aria-label={placeholder}
	aria-disabled={disabled}
	aria-readonly={readonly}
	onbeforeinput={handleBeforeInput}
	oninput={handleInput}
	oncompositionstart={handleCompositionStart}
	oncompositionend={handleCompositionEnd}
	onkeydown={handleKeydown}
	onfocus={handleFocus}
	onblur={handleBlur}
	onpaste={handlePaste}
>
	<Renderer {parsed} {debug} {customNodes} />
</div>
