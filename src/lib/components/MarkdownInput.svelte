<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import MarkdownLine from './MarkdownLine.svelte';
	import { defaultParser, type Parser, type Block, type InlineToken } from '../parser';
	import { serializeEditor } from '../dom/serialize';
	import {
		captureSelection,
		restoreSelection,
		makeCollapsedSelection,
		type RawSelection,
	} from '../cursor';
	import type { EventHandler } from 'svelte/elements';

	// ---------------------------------------------------------------------------
	// Props
	// ---------------------------------------------------------------------------

	let {
		value = $bindable(''),
		onchange,
		oninput,
		onsubmit,
		parser = defaultParser,
		submitOnEnter = false,
		class: className = '',
		placeholder = '',
		disabled = false,
		readonly = false,
		spellcheck = false,
		lineTag = 'div',
		lineClass = '',
		tokenSnippet,
		opaqueSnippet,
		debug,
	}: Partial<{
		value: string;
		onchange: (value: string) => void;
		oninput: (value: string) => void;
		onsubmit: (value: string) => void;
		parser: Parser;
		submitOnEnter: boolean;
		class: string;
		placeholder: string;
		disabled: boolean;
		readonly: boolean;
		spellcheck: boolean;
		lineTag: string;
		lineClass: string;
		tokenSnippet: Snippet<[InlineToken]>;
		opaqueSnippet: Snippet<[Block]>;
		debug: boolean;
	}> = $props();

	// ---------------------------------------------------------------------------
	// State
	// ---------------------------------------------------------------------------

	/** The raw markdown string — the single source of truth. */
	let rawValue = $state(value ?? '');

	/** The editor root element (bound via bind:this). */
	let editorEl = $state<HTMLElement | null>(null);

	/** True while an IME composition is in progress. */
	let isComposing = $state(false);

	/** True while the editor has focus. */
	let isFocused = $state(false);

	/**
	 * The last captured cursor position (raw space). Saved in `beforeinput`
	 * and used in `input` to restore after DOM patching.
	 */
	let savedCursor: RawSelection | null = null;

	// ---------------------------------------------------------------------------
	// Derived state
	// ---------------------------------------------------------------------------

	/** Parsed blocks — recomputed synchronously whenever rawValue changes. */
	let blocks = $derived.by(() => {
		const val = parser.parseBlocks(rawValue);
		if (debug) console.log('svelte-md debug:', { blocks: val });
		return val;
	});

	/**
	 * Inline tokens for every line, indexed by lineIndex.
	 * Empty arrays for opaque/blank blocks.
	 */
	let tokensByLine = $derived.by(() => {
		const val = blocks.map((b) => parser.tokenizeBlock(b));
		if (debug) console.log('svelte-md debug:', { tokensByLine: val });
		return val;
	});

	/**
	 * Block content start offsets, indexed by lineIndex.
	 * Used by serializeEditor and by the edit helpers.
	 */
	let contentStarts = $derived(blocks.map((b) => parser.getBlockContentStart(b)));

	// ---------------------------------------------------------------------------
	// External value sync
	// ---------------------------------------------------------------------------

	/**
	 * When the `value` prop changes from outside while the editor is not focused,
	 * sync it to internal state. If the editor IS focused, we ignore external
	 * changes to avoid fighting with the user's in-progress editing.
	 */
	$effect(() => {
		if (!isFocused && value !== rawValue) {
			rawValue = value ?? '';
		}
	});

	// ---------------------------------------------------------------------------
	// Edit helpers
	// ---------------------------------------------------------------------------

	/**
	 * Compute the absolute character offset (within the full raw string) that
	 * corresponds to a given `{ line, col }` raw-space point
	 */
	const absoluteOffset = (line: number, col: number): number => {
		let offset = 0;
		for (let i = 0; i < line; i++) {
			offset += blocks[i].raw.length + 1; // +1 for the \n separator
		}
		return offset + col;
	};

	/**
	 * Convert an absolute character offset back to a `{ line, col }` raw point.
	 */
	const pointFromAbsolute = (abs: number) => {
		let remaining = abs;
		for (let i = 0; i < blocks.length; i++) {
			const len = blocks[i].raw.length;
			if (remaining <= len) return { line: i, col: remaining };
			remaining -= len + 1; // consume line + newline
		}
		// Past the end — clamp to last position
		const last = blocks[blocks.length - 1];
		return { line: last?.lineIndex ?? 0, col: last?.raw.length ?? 0 };
	};

	/**
	 * Apply a text insertion or deletion to the raw string and trigger a
	 * reactive update. Returns the new cursor position in raw space.
	 *
	 * Handles ranged selections (deletes the selected range, then inserts).
	 *
	 * @param {RawSelection} cursor
	 * @param {string} insertText  - Text to insert ('' for pure deletion)
	 * @param {'none'|'backward'|'forward'} deleteDir
	 *   - `'none'`     — no additional deletion beyond range collapse
	 *   - `'backward'` — delete 1 char before the (collapsed) cursor
	 *   - `'forward'`  — delete 1 char after the (collapsed) cursor
	 * @returns {{ line: number, col: number }} New collapsed cursor position
	 */
	const applyEdit = (
		cursor: RawSelection,
		insertText: string,
		deleteDir: 'none' | 'backward' | 'forward' = 'none',
	): { line: number; col: number } => {
		let anchorAbs = absoluteOffset(cursor.anchor.line, cursor.anchor.col);
		let focusAbs = absoluteOffset(cursor.focus.line, cursor.focus.col);

		// Normalise: ensure start ≤ end regardless of selection direction
		let start = Math.min(anchorAbs, focusAbs);
		let end = Math.max(anchorAbs, focusAbs);

		// If selection is collapsed and a delete direction is requested, expand
		if (start === end) {
			if (deleteDir === 'backward' && start > 0) start -= 1;
			else if (deleteDir === 'forward' && end < rawValue.length) end += 1;
		}

		rawValue = rawValue.slice(0, start) + insertText + rawValue.slice(end);
		value = rawValue; // keep bindable prop in sync

		oninput?.(rawValue);

		// Cursor lands just after the inserted text
		return pointFromAbsolute(start + insertText.length);
	};

	/**
	 * Apply an edit, await Svelte's DOM update, then restore the cursor.
	 *
	 * @param {RawSelection} cursor
	 * @param {string}  insertText
	 * @param {'none'|'backward'|'forward'} [deleteDir]
	 */
	const applyEditAndRestoreCursor = async (
		cursor: RawSelection,
		insertText: string,
		deleteDir: 'none' | 'backward' | 'forward' = 'none',
	) => {
		const newPoint = applyEdit(cursor, insertText, deleteDir);
		await tick();
		if (editorEl) {
			restoreSelection(editorEl, makeCollapsedSelection(newPoint.line, newPoint.col), tokensByLine);
		}
	};

	// ---------------------------------------------------------------------------
	// Event handlers
	// ---------------------------------------------------------------------------

	/**
	 * `beforeinput` — intercepts most editing operations before the browser
	 * has a chance to mutate the DOM. We call `preventDefault()` and apply
	 * the change to the raw string model ourselves.
	 *
	 * Operations NOT intercepted here (handled in `input` as a fallback):
	 * - `insertFromPaste` / `insertFromPasteAsQuotation`
	 * - `insertTranspose`, `insertReplacementText` (spellcheck/autocorrect)
	 * - Any inputType we don't explicitly handle (treated as browser-managed)
	 *
	 * IME composition inputs are ignored here and handled via `compositionend`.
	 */
	const handleBeforeInput: EventHandler<InputEvent, HTMLDivElement> = (e) => {
		if (disabled || readonly || isComposing) return;
		if (!editorEl) return;

		// Capture cursor position before anything changes
		savedCursor = captureSelection(editorEl, tokensByLine);
		if (!savedCursor) return;

		switch (e.inputType) {
			// ── Character insertion ────────────────────────────────────────────────
			case 'insertText': {
				if (e.data === null || e.data === undefined) break;
				e.preventDefault();
				applyEditAndRestoreCursor(savedCursor, e.data);
				break;
			}

			// ── New line (Enter) ───────────────────────────────────────────────────
			case 'insertParagraph':
			case 'insertLineBreak': {
				e.preventDefault();
				// Because we intercepted submission shortcuts in `onkeydown`,
				// if this event fires, it strictly means a newline is intended.
				applyEditAndRestoreCursor(savedCursor, '\n');
				break;
			}

			// ── Backspace / delete-backward ────────────────────────────────────────
			case 'deleteContentBackward':
			case 'deleteWordBackward':
			case 'deleteSoftLineBackward':
			case 'deleteHardLineBackward': {
				e.preventDefault();
				applyEditAndRestoreCursor(savedCursor, '', 'backward');
				break;
			}

			// ── Delete / delete-forward ────────────────────────────────────────────
			case 'deleteContentForward':
			case 'deleteWordForward':
			case 'deleteSoftLineForward':
			case 'deleteHardLineForward': {
				e.preventDefault();
				applyEditAndRestoreCursor(savedCursor, '', 'forward');
				break;
			}

			// ── Paste / drag-drop / spellcheck: let browser handle ────────────────
			default:
				break;
		}
	};

	/**
	 * `input` — fallback handler for operations not intercepted in `beforeinput`.
	 *
	 * After a paste, autocorrect, or other browser-managed mutation, the DOM
	 * no longer matches our model. We serialise the DOM back to a raw string,
	 * update the model, and let Svelte re-render to get back in sync.
	 */
	async function handleInput() {
		if (disabled || readonly) return;
		if (!editorEl) return;
		if (isComposing) return; // compositionend handles this

		const newRaw = serializeEditor(editorEl, blocks, tokensByLine, contentStarts);
		if (newRaw === rawValue) return; // DOM in sync — nothing to do

		// Update model
		const cursor = savedCursor ?? captureSelection(editorEl, tokensByLine);
		rawValue = newRaw;
		value = rawValue;
		oninput?.(rawValue);

		// Wait for Svelte to re-render, then restore cursor
		await tick();
		if (editorEl && cursor) {
			restoreSelection(editorEl, cursor, tokensByLine);
		}
		savedCursor = null;
	}

	/**
	 * `compositionstart` — suppress model-first edits during IME composition.
	 * The browser owns the DOM state while composing.
	 */
	function handleCompositionStart() {
		isComposing = true;
		// Capture cursor before composition starts
		if (editorEl) savedCursor = captureSelection(editorEl, tokensByLine);
	}

	/**
	 * `compositionend` — composition is complete. Serialise the final composed
	 * text from the DOM and drive the reactive cycle normally.
	 */
	async function handleCompositionEnd() {
		isComposing = false;
		if (!editorEl) return;

		const newRaw = serializeEditor(editorEl, blocks, tokensByLine, contentStarts);
		if (newRaw === rawValue) return;

		const cursor = savedCursor ?? captureSelection(editorEl, tokensByLine);
		rawValue = newRaw;
		value = rawValue;
		oninput?.(rawValue);

		await tick();
		if (editorEl && cursor) {
			restoreSelection(editorEl, cursor, tokensByLine);
		}
		savedCursor = null;
	}

	/**
	 * `keydown` — intercepts keyboard shortcuts before they translate to input.
	 * * @param {KeyboardEvent} e
	 */
	function handleKeyDown(e: KeyboardEvent) {
		if (disabled || readonly || isComposing) return;

		if (e.key === 'Enter') {
			if (submitOnEnter && !e.shiftKey) {
				// Enter = submit; Shift+Enter = newline
				e.preventDefault();
				onsubmit?.(rawValue);
			} else if (!submitOnEnter && (e.ctrlKey || e.metaKey)) {
				// Ctrl/Cmd+Enter always submits regardless of submitOnEnter
				e.preventDefault();
				onsubmit?.(rawValue);
			}
			// If neither condition is met, we do NOT prevent default.
			// The browser will proceed to fire the `beforeinput` event
			// with inputType 'insertParagraph' or 'insertLineBreak'.
		}
	}

	function handleFocus() {
		isFocused = true;
	}

	function handleBlur() {
		isFocused = false;
		onchange?.(rawValue);
	}

	/**
	 * `paste` — strip HTML from clipboard to prevent rich-text paste.
	 * We rely on the `input` handler (via `insertFromPaste`) to pick up the
	 * plain-text result. This listener intercepts early to clean it.
	 *
	 * @param {ClipboardEvent} e
	 */
	function handlePaste(e: ClipboardEvent) {
		if (disabled || readonly) return;
		if (!editorEl) return;

		const plainText = e.clipboardData?.getData('text/plain');
		if (plainText === undefined || plainText === null) return;

		e.preventDefault();

		// Capture cursor before paste, then apply directly to the model
		const cursor = captureSelection(editorEl, tokensByLine);
		if (!cursor) return;

		applyEditAndRestoreCursor(cursor, plainText);
	}
</script>

<!--@component
	MarkdownInput — a rich markdown editor component for chat-style inputs.
   
	## Architecture
	
	The component uses a **model-first** edit cycle:
	
	1. `beforeinput` fires → cursor is captured in raw space.
	2. For known operations (typing, deletion, Enter), `preventDefault()` is
			called and the raw string model is updated directly — the browser never
			touches the DOM for these cases.
	3. Svelte's reactive `$derived` recomputes blocks and tokens from the new
			raw string synchronously.
	4. `await tick()` lets Svelte flush DOM updates.
	5. `restoreSelection` places the cursor back using the raw-space coordinates
			saved in step 1 (adjusted for any inserted/deleted characters).
	
	For operations the browser handles itself (paste, IME composition, spellcheck
	autocorrect, drag-drop), the `input` event fires after the DOM has been
	mutated. The serializer reads the DOM back to a raw string and re-drives
	the same reactive cycle.
	
	## Customisation
	
	The component intentionally imposes **no visual styling**. It renders plain
	semantic HTML with data attributes. Style via:
	
	- `class` / `style` props (forwarded to the outer `contenteditable` wrapper)
	- CSS targeting `[data-md-block-type]` and `[data-md-type]` attributes
	- `tokenSnippet` / `opaqueSnippet` Svelte 5 snippets for custom rendering
	- `lineTag` / `lineClass` for custom line container elements
-->

<!--
  The outer div is the contenteditable root. All [data-md-line] elements are
  direct children. The placeholder is implemented via CSS ::before pseudo-
  element using the data-placeholder attribute — this avoids any JS-side
  visibility toggle and works even in empty state.

  Attributes forwarded to the element:
  - class — consumer styling
  - data-placeholder — CSS placeholder support
  - aria-* — accessibility
-->
<div
	bind:this={editorEl}
	class={className || undefined}
	contenteditable={disabled || readonly ? undefined : 'true'}
	role="textbox"
	tabindex="0"
	aria-multiline="true"
	aria-label={placeholder || undefined}
	aria-disabled={disabled || undefined}
	aria-readonly={readonly || undefined}
	{spellcheck}
	autocapitalize="off"
	data-placeholder={placeholder || undefined}
	data-md-editor
	onbeforeinput={handleBeforeInput}
	oninput={handleInput}
	oncompositionstart={handleCompositionStart}
	oncompositionend={handleCompositionEnd}
	onkeydown={handleKeyDown}
	onfocus={handleFocus}
	onblur={handleBlur}
	onpaste={handlePaste}
>
	{#each blocks as block (block.lineIndex)}
		<MarkdownLine
			{block}
			tokens={tokensByLine[block.lineIndex] ?? []}
			{lineTag}
			{lineClass}
			{tokenSnippet}
			{opaqueSnippet}
		/>
	{/each}
</div>
