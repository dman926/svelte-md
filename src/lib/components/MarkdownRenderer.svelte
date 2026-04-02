<script lang="ts">
	import type { Snippet } from 'svelte';
	import { defaultParser, type Parser, type Block, type InlineToken } from '../parser';
	import MarkdownLine from './MarkdownLine.svelte';

	const {
		lineClass,
		tokenSnippet,
		opaqueSnippet,
		debug,
		...rest
	}: ({ value: string; parser?: Parser } | { blocks: Block[]; tokensByLine: InlineToken[][] }) &
		Partial<{
			lineClass: string;
			tokenSnippet: Snippet<[InlineToken]>;
			opaqueSnippet: Snippet<[Block]>;
			debug: boolean;
		}> = $props();

	type NestedBlockGroup = {
		kind: 'ol' | 'ul' | 'blockquote';
		blocks: Array<Block | NestedBlockGroup | [Block, NestedBlockGroup]>;
		key: number;
	};

	type BlockGroup =
		| {
				kind: 'single';
				block: Block;
				key: number;
		  }
		| {
				kind: 'paragraph';
				blocks: Block[];
				key: number;
		  }
		| NestedBlockGroup
		| {
				kind: 'pre';
				open: Block;
				body: Block[];
				close: Block | null;
				lang: string;
				key: number;
		  };

	const blocks = $derived.by(() => {
		if ('value' in rest) {
			const { value, parser = defaultParser } = rest;
			if (!parser) throw new Error('Parser instance is required when passing source string');
			return parser.parseBlocks(value);
		}
		return rest.blocks;
	});

	/** Grouped representation of blocks for semantic wrappers (ul/ol around list items) */
	const blockGroups = $derived.by(() => {
		const groups: BlockGroup[] = [];
		let i = 0;

		while (i < blocks.length) {
			const block = blocks[i++];

			if (block.type == 'list_item' || block.type == 'blockquote') {
				// Gather consecutive list items into a group
				const getListType = (block: Block) => {
					if (block.type == 'blockquote') return 'blockquote';
					return block.meta.ordered ? 'ol' : 'ul';
				};

				const gatherBlocks = (startI: number, depth: number) => {
					const nestedBlocks: NestedBlockGroup['blocks'] = [];
					while (
						i < blocks.length &&
						blocks[i].type == block.type &&
						blocks[i].meta.ordered == blocks[startI].meta.ordered
					) {
						const newBlock = blocks[i++];
						const newBlockDepth = newBlock.meta.depth ?? 1;
						const nextBlock = blocks[i];
						if (
							block.type != 'blockquote' &&
							nextBlock &&
							nextBlock.type == block.type &&
							(nextBlock.meta.depth ?? 1) > newBlockDepth
						) {
							// Handle nesting lists
							nestedBlocks.push([
								newBlock,
								{
									kind: getListType(nextBlock),
									blocks: gatherBlocks(i, nextBlock.meta.depth ?? 1),
									key: nextBlock.lineIndex,
								},
							]);
						} else if (newBlockDepth > depth) {
							// Handle nesting blockquotes
							nestedBlocks.push({
								kind: getListType(newBlock),
								blocks: gatherBlocks(--i, newBlock.meta.depth ?? 1),
								key: newBlock.lineIndex,
							});
						} else if (newBlockDepth == depth) {
							nestedBlocks.push(newBlock);
						} else {
							// End of list
							return nestedBlocks;
						}
					}
					return nestedBlocks;
				};
				groups.push({
					kind: getListType(block),
					blocks: gatherBlocks(--i, block.meta.depth ?? 1),
					key: block.lineIndex,
				});
			} else if (block.type == 'code_fence_open') {
				// Gather code fence body and closing fence
				const lang = block.meta.lang ?? '';
				const open = block;
				const body: Block[] = [];
				while (i < blocks.length && blocks[i].type == 'code_fence_body') {
					body.push(blocks[i++]);
				}
				const close =
					i < blocks.length && blocks[i].type == 'code_fence_close' ? blocks[i++] : null;
				if (!close) {
					// Unclosed fence — treat the rest as body
					body.push(...blocks.slice(i));
					i = blocks.length;
				}
				groups.push({ kind: 'pre', open, body, close, lang, key: open.lineIndex });
			} else if (block.type == 'paragraph') {
				// Group lines of a paragraph
				const paraBlocks = [block];
				while (i < blocks.length && blocks[i].type == 'paragraph') {
					paraBlocks.push(blocks[i++]);
				}
				groups.push({ kind: 'paragraph', blocks: paraBlocks, key: block.lineIndex });
			} else {
				// Regular single block
				groups.push({ kind: 'single', block, key: block.lineIndex });
			}
		}

		if (debug) console.log('svelte-md debug:', { groups });

		return groups;
	});

	const tokensByLine = $derived.by(() => {
		if ('tokensByLine' in rest) {
			return rest.tokensByLine;
		} else {
			const { parser = defaultParser } = rest;
			const val = blocks.map((b) => parser.tokenizeBlock(b));
			if (debug) console.log('svelte-md debug:', { tokensByLine: val });
			return val;
		}
	});

	const getKey = (block: NestedBlockGroup['blocks'][number]) => {
		if (Array.isArray(block)) {
			return block[0].lineIndex;
		} else if ('lineIndex' in block) return block.lineIndex;
		else return block.key;
	};
</script>

{#each blockGroups as group (group.key)}
	{#if group.kind == 'single'}
		<MarkdownLine
			block={group.block}
			tokens={tokensByLine[group.block.lineIndex] ?? []}
			{lineClass}
			{tokenSnippet}
			{opaqueSnippet}
		/>
	{:else if group.kind == 'paragraph'}
		<p data-md-block-type="paragraph">
			{#each group.blocks as block, i (block.lineIndex)}
				<MarkdownLine
					{block}
					tokens={tokensByLine[block.lineIndex] ?? []}
					lineTag="span"
					{lineClass}
					{tokenSnippet}
					{opaqueSnippet}
				/>
				{#if i != group.blocks.length - 1}
					<!-- Newline between paragraph lines. -->
					<br class="svelte-md-paragraph-line-break" />
				{/if}
			{/each}
		</p>
	{:else if group.kind == 'ul' || group.kind == 'ol'}
		{#snippet nestedRenderer(blockGroup: NestedBlockGroup)}
			<svelte:element this={blockGroup.kind} data-md-block-type={blockGroup.kind}>
				{#each blockGroup.blocks as block (getKey(block))}
					{#if Array.isArray(block)}
						<li>
							<MarkdownLine
								block={block[0]}
								tokens={tokensByLine[block[0].lineIndex] ?? []}
								lineTag="span"
								{lineClass}
								{tokenSnippet}
								{opaqueSnippet}
							/>
							{@render nestedRenderer(block[1])}
						</li>
					{:else if 'lineIndex' in block}
						<MarkdownLine
							{block}
							tokens={tokensByLine[block.lineIndex] ?? []}
							lineTag="li"
							{lineClass}
							{tokenSnippet}
							{opaqueSnippet}
						/>
					{:else}
						<li>
							{@render nestedRenderer(block)}
						</li>
					{/if}
				{/each}
			</svelte:element>
		{/snippet}
		{@render nestedRenderer(group)}
	{:else if group.kind == 'blockquote'}
		{#snippet nestedRenderer(blockGroup: NestedBlockGroup)}
			<blockquote data-md-block-type="blockquote">
				{#each blockGroup.blocks as block (getKey(block))}
					{#if Array.isArray(block)}
						<!-- Do nothing. Shouldn't happen -->
					{:else if 'lineIndex' in block}
						<MarkdownLine
							{block}
							tokens={tokensByLine[block.lineIndex] ?? []}
							lineTag="p"
							{lineClass}
							{tokenSnippet}
							{opaqueSnippet}
						/>
					{:else}
						{@render nestedRenderer(block)}
					{/if}
				{/each}
			</blockquote>
		{/snippet}
		{@render nestedRenderer(group)}
	{:else if group.kind == 'pre'}
		<pre data-md-block-type="code_fence" data-md-lang={group.lang}>
				{#if group.open.raw.trim()}
				<MarkdownLine
					block={group.open}
					tokens={[]}
					lineClass={`${lineClass} md-code-fence-open`.trim()}
					tokenSnippet={undefined}
					opaqueSnippet={undefined}
				/>
			{/if}

				{#each group.body as block (block.lineIndex)}
				<MarkdownLine
					{block}
					tokens={[]}
					lineClass={`${lineClass} md-code-fence-body`.trim()}
					tokenSnippet={undefined}
					opaqueSnippet={undefined}
				/>
			{/each}

				{#if group.close?.raw.trim()}
				<MarkdownLine
					block={group.close!}
					tokens={[]}
					lineClass={`${lineClass} md-code-fence-close`.trim()}
					tokenSnippet={undefined}
					opaqueSnippet={undefined}
				/>
			{/if}
			</pre>
	{/if}
{/each}
