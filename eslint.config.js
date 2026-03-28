import prettier from 'eslint-config-prettier';
import path from 'node:path';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import svelteConfig from './svelte.config.js';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	[
		includeIgnoreFile(gitignorePath),
		js.configs.recommended,
		ts.configs.recommended,
		svelte.configs.recommended,
		{
			languageOptions: { globals: { ...globals.browser, ...globals.node } },
		},

		{
			files: ['**/*.svelte', '**/*.svelte.js'],
			languageOptions: { parserOptions: { svelteConfig, parser: ts.parser } },
		},
	],
	prettier,
	svelte.configs.prettier,

	{
		rules: {
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
				},
			],
		},
	},
);
