import type { LayoutServerLoad } from './$types';
import { readFile } from 'fs/promises';

const defaultContent = ``;

export const load: LayoutServerLoad = () =>
	readFile('./SAVED-MARKDOWN.md', 'utf-8')
		.then((content) => ({
			content,
		}))
		.catch(() => ({
			content: defaultContent,
		}));
