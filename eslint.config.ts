import stylistic from "@stylistic/eslint-plugin";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

// Replaces `biome check .`, which carried THREE jobs in one command: lint rules,
// formatting, and import organisation. eslint core dropped formatting rules in
// v8.53, so the first two of those needed a plugin each rather than a config
// line, and losing them silently while calling the linter "unified" would have
// been a capability cut nobody asked for.
//
// The formatting block below is a 1:1 transcription of the `biome.json` this
// replaces -- tab indent, width 140, double quotes, always semicolons, trailing
// commas everywhere, always-parenthesised arrow parameters. Transcribed rather
// than re-chosen: the tree is already formatted to those settings, so any
// deviation here shows up as a repo-wide diff that is style churn, not work.
//
// One honest difference from biome: @stylistic is RULE-based, biome is
// PRINT-based. A print formatter reprints from the AST and guarantees canonical
// output; a rule formatter enforces the axes it has rules for and leaves shapes
// no rule covers. The axes biome.json actually pinned are all covered here, so
// this is equivalent for the settings this repository chose -- not for every
// possible reformatting biome might have done.
export default tseslint.config(
	{
		ignores: [
			"**/dist/**",
			"**/node_modules/**",
			// The frozen protocol copy is excluded for the same reason `biome.json`
			// excluded it: a lint finding there is one this lane may not act on, and
			// "just fix the lint error" is how a frozen copy drifts.
			"packages/ceal-protocol/**",
			"packages/ceal-worker-cli/src/generated/**",
		],
	},
	{
		files: ["**/*.ts", "**/*.mjs"],
		extends: [tseslint.configs.recommended],
		plugins: { "@stylistic": stylistic, "simple-import-sort": simpleImportSort, sonarjs },
		rules: {
			// biome `suspicious.noExplicitAny: "error"`.
			"@typescript-eslint/no-explicit-any": "error",
			// biome's recommended set enforced `complexity/useRegexLiterals`, and one
			// site suppressed it. Porting only the suppression would have turned the
			// rule off tree-wide while leaving a directive that suppressed nothing.
			"prefer-regex-literals": "error",
			// The `_` prefix is this tree's deliberate intentionally-unused marker, and
			// the Gateway's config already spells the same pattern. Without it the rule
			// reports 15 sites that are all convention, not defects.
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],

			// biome `assist/source/organizeImports`, which `biome format` did NOT
			// carry -- only `biome check` did. Verified by swapping two imports:
			// `biome check` failed, `biome format` exited 0.
			// One group, so imports are SORTED without gaining blank-line separators.
			// simple-import-sort inserts a blank line between its default groups and
			// biome's organizeImports did not; leaving the default turned 148 files
			// into a diff that was mostly inserted blank lines.
			"simple-import-sort/imports": ["error", { groups: [["^\\u0000", "^"]] }],
			"simple-import-sort/exports": "error",

			// Convergence with the Gateway repo, which turned these on the same day
			// after measuring them. They are within-file and function-granular, so
			// they complement `lint:duplicate-literal` rather than repeating it: that
			// gate reports a REGEX literal spelled in two owned modules, and these
			// report an identical function body or a self-identical expression inside
			// one file.
			//
			// Measured on this tree before enabling: no-identical-expressions 0,
			// no-identical-functions 3 across 2 files. NOT enabled here:
			// `sonarjs/no-duplicate-string`, which reports 321 across 43 files -- more
			// than the Gateway's 165 in a smaller tree. That one needs the bulk-
			// suppression baseline the Gateway chose, and it is its own slice.
			"sonarjs/no-identical-functions": "error",
			"sonarjs/no-identical-expressions": "error",

			// biome `formatter` + `javascript.formatter`, transcribed.
			"@stylistic/indent": ["error", "tab", { offsetTernaryExpressions: true }],
			// 140 with tabWidth 1, because that is the scale biome measured on:
			// `indentStyle: "tab"` with `indentWidth: 1` counted a tab as ONE column,
			// and @stylistic defaults to four. Measured on biome's own scale the tree
			// has zero lines over 140, so the width transcribes exactly. An earlier
			// version of this rule missed the tab-width difference, read the resulting
			// phantom violations as a real 141-148 residue, and raised the cap to 150
			// to accommodate lines that were never that long.
			"@stylistic/max-len": ["error", { code: 140, tabWidth: 1, ignoreComments: true, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreRegExpLiterals: true }],
			"@stylistic/quotes": ["error", "double", { avoidEscape: true, allowTemplateLiterals: "never" }],
			"@stylistic/semi": ["error", "always"],
			"@stylistic/comma-dangle": ["error", "always-multiline"],
			"@stylistic/arrow-parens": ["error", "always"],
		},
	},
	{
		// biome override: this tree spells web globals through `globalThis`, so the
		// bare names are denied in `.mjs`. Same six names, same reason.
		files: ["**/*.mjs"],
		rules: {
			"no-restricted-globals": [
				"error",
				...["Response", "Request", "Headers", "ReadableStream", "WritableStream", "TransformStream"].map((name) => ({
					name,
					message: `Use globalThis.${name}; this tree spells web globals through globalThis. See docs/gates.md.`,
				})),
			],
		},
	},
);
