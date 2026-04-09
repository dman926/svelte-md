# svelte-md

[![NPM Version](https://img.shields.io/npm/v/%40dman926%2Fsvelte-md)](https://www.npmjs.com/package/@dman926/svelte-md)

A lightweight markdown renderer and editor for svelte

## Why

I wanted an inline editor like chat boxes on AI platforms, but all I could find were renderers, tokenizers, or side-by-side editors. I tried to build a solution using them, but they got quickly out of hand needing to adjust tokenization logic to better handle editing, namely with handling where the cursor belongs, and was also not very performant since every keystroke demanded a full re-parsing step. So I decided to build my own solution

## Features

- Only dependency is svelte for rendering
- Optimized performance through incremental parsing
- Customizable with extensible block and inline parser rules

## Install

```
npm i @dman926/svelte-md
```

```
yarn add @dman926/svelte-md
```

```
pnpm add @dman926/svelte-md
```

## Usage

### Renderer usage

```svelte
<script>
	import {
		Renderer, // or `MarkdownRenderer`
		createParser,
	} from '@dman926/svelte-md';

	const sourceString = '# My markdown string';

	// Optionally provide a parser
	// This is the default parser, so this has no change over not providing it at all
	const parser = createParser({
		block: {
			rules: [
				// Add extra rules for custom block tokens
				// {
				//   name: 'some_new_block'
				//   isContainer: true, // If this block can have children
				//   tryStart: (line, context) => { /* Handle the start of the block when parsing */ }
				//   tryContinue: (line, node, context) => { /* Handle the continuation of the block when parsing */ }
				//   finalize: (node) => { /* Handle any finalization when parsing the block */ }
				// }
			],
			disableRules: [
				// Disable any existing block rules by name
				// 'thematic_break'
			],
		},
		inline: {
			rules: [
        // Add extra rules for custom inline tokens
        // {
        //   name: 'some_new_inline',
        //   scan: (raw, pos, end, getRange) => { /* scan the raw string for the token */ }
        // }
      ],
			disableRules: [
        // Disable any existing block rules by name
				// 'image'
      ],
			// How to handle breaks inside paragraphs. 'space' or 'break'
			softBreaks: 'space',
		},
	});
</script>

<Renderer value={sourceString} {parser} />
```

### Editor usage

```svelte
<script>
  import { Editor /* `MarkdownEditor` */ } from '@dman926/svelte-md';

  let sourceString = $state('# My markdown string')

  const onsubmit = () => {
    // Handle the submission
  }
</script>

<!-- Optionally provide a parser just like with Renderer -->
<Editor
  bind:value={sourceString}
  {onsubmit}
  placeholder="Type markdown..."
/>
```
