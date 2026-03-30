// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import MarkdownInput from './MarkdownInput.svelte';
import { LINE_ATTR, TOKEN_ATTR } from '../cursor/types';

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render MarkdownInput with given props, return { container, editor, getEditor }. */
function renderEditor(props = {}) {
	const result = render(MarkdownInput, { props });
	const editor = /** @type {Element} */ (result.container.querySelector('[data-md-editor]'));
	expect(editor).not.toBeNull();
	return { ...result, editor };
}

/**
 * Fire a beforeinput event on the editor element.
 * jsdom supports InputEvent with inputType.
 * @param {Element} editor
 * @param {string} inputType
 * @param {string | null} [data]
 */
function fireBeforeInput(editor, inputType, data = null) {
	return fireEvent(
		editor,
		new InputEvent('beforeinput', {
			bubbles: true,
			cancelable: true,
			inputType,
			data,
		}),
	);
}

// ---------------------------------------------------------------------------
// Root element structure
// ---------------------------------------------------------------------------

describe('MarkdownInput — root element', () => {
	it('renders a div with data-md-editor attribute', () => {
		const { editor } = renderEditor();
		expect(editor).not.toBeNull();
		expect(editor?.tagName).toBe('DIV');
		expect(editor?.hasAttribute('data-md-editor')).toBe(true);
	});

	it('has role="textbox"', () => {
		const { editor } = renderEditor();
		expect(editor?.getAttribute('role')).toBe('textbox');
	});

	it('has aria-multiline="true"', () => {
		const { editor } = renderEditor();
		expect(editor?.getAttribute('aria-multiline')).toBe('true');
	});

	it('contenteditable="true" when not disabled or readonly', () => {
		const { editor } = renderEditor();
		expect(editor?.getAttribute('contenteditable')).toBe('true');
	});

	it('contenteditable absent when disabled=true', () => {
		const { editor } = renderEditor({ disabled: true });
		expect(editor?.hasAttribute('contenteditable')).toBe(false);
	});

	it('contenteditable absent when readonly=true', () => {
		const { editor } = renderEditor({ readonly: true });
		expect(editor?.hasAttribute('contenteditable')).toBe(false);
	});

	it('autocapitalize="off" always set', () => {
		const { editor } = renderEditor();
		expect(editor?.getAttribute('autocapitalize')).toBe('off');
	});
});

// ---------------------------------------------------------------------------
// Props: placeholder
// ---------------------------------------------------------------------------

describe('MarkdownInput — placeholder prop', () => {
	it('data-placeholder attribute set when placeholder provided', () => {
		const { editor } = renderEditor({ placeholder: 'Type here…' });
		expect(editor?.getAttribute('data-placeholder')).toBe('Type here…');
	});

	it('data-placeholder absent when placeholder is empty string', () => {
		const { editor } = renderEditor({ placeholder: '' });
		expect(editor?.hasAttribute('data-placeholder')).toBe(false);
	});

	it('aria-label set from placeholder', () => {
		const { editor } = renderEditor({ placeholder: 'Write a message' });
		expect(editor?.getAttribute('aria-label')).toBe('Write a message');
	});
});

// ---------------------------------------------------------------------------
// Props: accessibility
// ---------------------------------------------------------------------------

describe('MarkdownInput — accessibility props', () => {
	it('aria-disabled set when disabled=true', () => {
		const { editor } = renderEditor({ disabled: true });
		expect(editor?.getAttribute('aria-disabled')).toBe('true');
	});

	it('aria-disabled absent when not disabled', () => {
		const { editor } = renderEditor({ disabled: false });
		expect(editor?.hasAttribute('aria-disabled')).toBe(false);
	});

	it('aria-readonly set when readonly=true', () => {
		const { editor } = renderEditor({ readonly: true });
		expect(editor?.getAttribute('aria-readonly')).toBe('true');
	});

	it('aria-readonly absent when not readonly', () => {
		const { editor } = renderEditor({ readonly: false });
		expect(editor?.hasAttribute('aria-readonly')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Props: spellcheck, class
// ---------------------------------------------------------------------------

describe('MarkdownInput — spellcheck and class props', () => {
	it('spellcheck=false by default', () => {
		const { editor } = renderEditor();
		// spellcheck attribute is "false" as a string in HTML
		expect(editor?.getAttribute('spellcheck')).toBe('false');
	});

	it('spellcheck=true when prop is true', () => {
		const { editor } = renderEditor({ spellcheck: true });
		expect(editor?.getAttribute('spellcheck')).toBe('true');
	});

	it('class prop forwarded to editor element', () => {
		const { editor } = renderEditor({ class: 'my-editor compact' });
		expect(editor?.classList.contains('my-editor')).toBe(true);
		expect(editor?.classList.contains('compact')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Initial value rendering
// ---------------------------------------------------------------------------

describe('MarkdownInput — initial value rendering', () => {
	it('renders one line element per source line', () => {
		const { editor } = renderEditor({ value: 'line0\nline1\nline2' });
		const lineEls = editor?.querySelectorAll(`[${LINE_ATTR}]`);
		expect(lineEls?.length).toBe(3);
	});

	it('line elements have correct data-md-line indices', () => {
		const { editor } = renderEditor({ value: 'a\nb\nc' });
		expect(editor?.querySelector(`[${LINE_ATTR}="0"]`)).not.toBeNull();
		expect(editor?.querySelector(`[${LINE_ATTR}="1"]`)).not.toBeNull();
		expect(editor?.querySelector(`[${LINE_ATTR}="2"]`)).not.toBeNull();
	});

	it('empty value renders one blank line', () => {
		const { editor } = renderEditor({ value: '' });
		const lineEls = editor?.querySelectorAll(`[${LINE_ATTR}]`);
		expect(lineEls?.length).toBe(1);
	});

	it('bold syntax produces <strong> with data-md-type="bold"', () => {
		const { editor } = renderEditor({ value: '**bold**' });
		const strong = editor?.querySelector('strong[data-md-type="bold"]');
		expect(strong).not.toBeNull();
		expect(strong?.textContent).toBe('bold');
	});

	it('italic syntax produces <em> with data-md-type="italic"', () => {
		const { editor } = renderEditor({ value: '*italic*' });
		const em = editor?.querySelector('em[data-md-type="italic"]');
		expect(em).not.toBeNull();
		expect(em?.textContent).toBe('italic');
	});

	it('code syntax produces <code> with data-md-type="code"', () => {
		const { editor } = renderEditor({ value: '`code`' });
		expect(editor?.querySelector('code[data-md-type="code"]')).not.toBeNull();
	});

	it('heading block has data-md-block-type="heading"', () => {
		const { editor } = renderEditor({ value: '# Title' });
		const lineEl = editor?.querySelector('[data-md-block-type="heading"]');
		expect(lineEl).not.toBeNull();
	});

	it('blank lines render a <br> placeholder', () => {
		const { editor } = renderEditor({ value: 'a\n\nb' });
		const blankLine = editor?.querySelector('[data-md-line="1"]');
		expect(blankLine?.querySelector('br')).not.toBeNull();
	});

	it('code fence body has no data-md-token children', () => {
		const { editor } = renderEditor({ value: '```\nconst x = 1;\n```' });
		const body = editor?.querySelector('[data-md-block-type="code_fence_body"]');
		expect(body).not.toBeNull();
		expect(body?.querySelectorAll(`[${TOKEN_ATTR}]`).length).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// lineTag and lineClass props
// ---------------------------------------------------------------------------

describe('MarkdownInput — lineTag / lineClass forwarded to MarkdownLine', () => {
	it('lineTag changes line container elements', () => {
		const { editor } = renderEditor({ value: 'hello', lineTag: 'p' });
		const lineEl = editor?.querySelector(`[${LINE_ATTR}="0"]`);
		expect(lineEl?.tagName).toBe('P');
	});

	it('lineClass adds class to every line container', () => {
		const { editor } = renderEditor({ value: 'a\nb', lineClass: 'row' });
		const lineEls = editor?.querySelectorAll(`[${LINE_ATTR}]`) ?? [];
		for (const el of lineEls) {
			expect(el.classList.contains('row')).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// oninput callback
// ---------------------------------------------------------------------------

describe('MarkdownInput — oninput callback', () => {
	it('oninput called when beforeinput insertText fires', async () => {
		const oninput = vi.fn();
		const { editor } = renderEditor({ value: '', oninput });

		// Place a cursor — without a real DOM selection the handler may bail,
		// so we set up a minimal selection on the blank line's br
		const brEl = /** @type {HTMLBRElement} */ (editor?.querySelector('br'));
		const range = document.createRange();
		range.setStartBefore(brEl);
		range.collapse(true);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range);

		fireBeforeInput(editor, 'insertText', 'H');
		// Allow microtask queue to flush (applyEditAndRestoreCursor is async)
		await new Promise((r) => setTimeout(r, 0));

		expect(oninput).toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// onchange callback
// ---------------------------------------------------------------------------

describe('MarkdownInput — onchange callback', () => {
	it('onchange called on blur', () => {
		const onchange = vi.fn();
		const { editor } = renderEditor({ value: 'hello', onchange });
		fireEvent.blur(editor);
		expect(onchange).toHaveBeenCalledWith('hello');
	});

	it('onchange receives current raw value', () => {
		const onchange = vi.fn();
		const { editor } = renderEditor({ value: '**bold**', onchange });
		fireEvent.blur(editor);
		expect(onchange).toHaveBeenCalledWith('**bold**');
	});
});

// ---------------------------------------------------------------------------
// onsubmit callback
// ---------------------------------------------------------------------------

describe('MarkdownInput — onsubmit with submitOnEnter=false (default)', () => {
	it('Ctrl+Enter fires onsubmit', () => {
		const onsubmit = vi.fn();
		const { editor } = renderEditor({ value: 'hello', onsubmit });
		fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
		expect(onsubmit).toHaveBeenCalledWith('hello');
	});

	it('Meta+Enter fires onsubmit', () => {
		const onsubmit = vi.fn();
		const { editor } = renderEditor({ value: 'hello', onsubmit });
		fireEvent.keyDown(editor, { key: 'Enter', metaKey: true });
		expect(onsubmit).toHaveBeenCalledWith('hello');
	});

	it('plain Enter does NOT fire onsubmit when submitOnEnter=false', () => {
		const onsubmit = vi.fn();
		const { editor } = renderEditor({ value: 'hello', onsubmit, submitOnEnter: false });
		// insertParagraph would be the inputType, but keyDown alone doesn't trigger it
		// This confirms the keydown handler doesn't fire for plain Enter
		fireEvent.keyDown(editor, { key: 'Enter' });
		expect(onsubmit).not.toHaveBeenCalled();
	});
});

describe('MarkdownInput — onsubmit with submitOnEnter=true', () => {
	it('keydown Enter fires onsubmit when submitOnEnter is true', async () => {
		const onsubmit = vi.fn();
		const { editor } = renderEditor({ value: 'hello', onsubmit, submitOnEnter: true });

		// Fire a keydown event for 'Enter' without the shift key
		await fireEvent.keyDown(editor, { key: 'Enter', shiftKey: false });

		expect(onsubmit).toHaveBeenCalledWith('hello');
	});

	it('keydown Shift+Enter does not fire onsubmit', async () => {
		const onsubmit = vi.fn();
		const { editor } = renderEditor({ value: 'hello', onsubmit, submitOnEnter: true });

		// Fire a keydown event for 'Enter' WITH the shift key
		await fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true });

		// The component should allow default behavior, eventually triggering insertParagraph
		expect(onsubmit).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// disabled and readonly — events ignored
// ---------------------------------------------------------------------------

describe('MarkdownInput — disabled/readonly blocks editing', () => {
	it('disabled: beforeinput insertText is ignored', () => {
		const oninput = vi.fn();
		const { editor } = renderEditor({ value: 'hello', oninput, disabled: true });
		fireBeforeInput(editor, 'insertText', 'X');
		expect(oninput).not.toHaveBeenCalled();
	});

	it('readonly: beforeinput insertText is ignored', () => {
		const oninput = vi.fn();
		const { editor } = renderEditor({ value: 'hello', oninput, readonly: true });
		fireBeforeInput(editor, 'insertText', 'X');
		expect(oninput).not.toHaveBeenCalled();
	});

	it('disabled: onsubmit not called from keydown', () => {
		const onsubmit = vi.fn();
		const { editor } = renderEditor({ value: 'hello', onsubmit, disabled: true });
		fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
		expect(onsubmit).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Custom parser
// ---------------------------------------------------------------------------

describe('MarkdownInput — custom parser', () => {
	it('custom parser is used for rendering', async () => {
		const { createParser } = await import('../parser');
		// Parser with headings disabled — # should become paragraph
		const parser = createParser({ block: { heading: false } });
		const { editor } = renderEditor({ value: '# Not Heading', parser });
		const lineEl = editor?.querySelector('[data-md-line="0"]');
		expect(lineEl?.getAttribute('data-md-block-type')).toBe('paragraph');
	});
});
