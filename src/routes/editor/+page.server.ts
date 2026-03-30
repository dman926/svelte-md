import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { writeFile } from 'fs/promises';

export const actions: Actions = {
	default: async ({ request }) => {
		const formData = await request.formData();
		const content = formData.get('content');
		if (content === null || typeof content != 'string') {
			return fail(400, { content, missing: true });
		}
		try {
			await writeFile('./SAVED-MARKDOWN.md', content);
		} catch (e) {
			console.error(e);
			return fail(500, { error: e instanceof Error ? e.message : String(e) });
		}

		return { success: true };
	},
};
