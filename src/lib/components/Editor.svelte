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
		ariaLabel,
		name,
		onchange,
		oninput,
		onsubmit,
		class: className,
		placeholderClass,
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
		ariaLabel: string;
		name: string;
		onchange: (value: string) => void;
		oninput: (value: string) => void;
		onsubmit: (value: string) => void;
		class: string;
		placeholderClass: string;
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

	const findWordBoundaryBackward = (text: string, pos: number): number => {
		let i = pos;
		while (i > 0 && /\s/.test(text[i - 1])) i--;
		while (i > 0 && /\S/.test(text[i - 1])) i--;
		return i;
	};

	const findWordBoundaryForward = (text: string, pos: number): number => {
		let i = pos;
		while (i < text.length && /\s/.test(text[i])) i++;
		while (i < text.length && /\S/.test(text[i])) i++;
		return i;
	};

	/** @returns The new offset*/
	const applyEdit = (
		cursor: RawSelection,
		insertText: string,
		deleteDir: 'none' | 'backward' | 'forward' | 'wordBackward' | 'wordForward' = 'none',
	) => {
		let start = Math.min(cursor.anchor, cursor.focus);
		let end = Math.max(cursor.anchor, cursor.focus);

		if (start == end) {
			if (deleteDir == 'backward' && start > 0) start -= 1;
			else if (deleteDir == 'forward' && end < value.length) end += 1;
			else if (deleteDir == 'wordBackward') start = findWordBoundaryBackward(value, start);
			else if (deleteDir == 'wordForward') end = findWordBoundaryForward(value, end);
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
		deleteDir: 'none' | 'backward' | 'forward' | 'wordBackward' | 'wordForward' = 'none',
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

		savedCursor = captureSelection(editorEl, parsed);
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
				if (submitOnEnter) break;
				applyEditAndRestore(savedCursor, '\n');
				break;

			case 'deleteContentBackward':
				e.preventDefault();
				applyEditAndRestore(savedCursor, '', 'backward');
				break;
			case 'deleteWordBackward':
				e.preventDefault();
				applyEditAndRestore(savedCursor, '', 'wordBackward');
				break;

			case 'deleteContentForward':
				e.preventDefault();
				applyEditAndRestore(savedCursor, '', 'forward');
				break;
			case 'deleteWordForward':
				e.preventDefault();
				applyEditAndRestore(savedCursor, '', 'wordForward');
				break;
		}
	};

	const handleInput = async () => {
		if (disabled || readonly || isComposing || !editorEl) return;

		// Fallback for things like Spellcheck or Drag & Drop that mutate DOM directly
		// We re-parse fully if the DOM gets out of sync because incremental
		// update requires precise EditRanges which browser-mutated DOM doesn't provide easily.
		const newRaw = editorEl.innerText.replace(/\n$/, ''); // Simple serialization
		if (newRaw == value) return;

		const cursor = captureSelection(editorEl, parsed);
		value = newRaw;
		parsed = parser.parse(value); // Full re-parse as fallback
		oninput?.(value);

		await tick();
		if (editorEl && cursor) restoreSelection(editorEl, cursor, parsed);
	};

	const handleCompositionStart = () => {
		isComposing = true;
		if (editorEl) savedCursor = captureSelection(editorEl, parsed);
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
			const current = captureSelection(editorEl, parsed);
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

		const cursor = captureSelection(editorEl, parsed);
		if (cursor) applyEditAndRestore(cursor, text);
	};
</script>

<div class="md-editor-root">
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
		aria-multiline="true"
		aria-label={ariaLabel || placeholder}
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
	{#if value.length == 0 && placeholder}
		<span class={['md-placeholder', placeholderClass].filter(Boolean).join(' ')} aria-hidden="true">
			{placeholder}
		</span>
	{/if}
</div>

<style>
	.md-editor-root {
		position: relative;
	}
	.md-placeholder {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
		white-space: pre-wrap;
	}
</style>
