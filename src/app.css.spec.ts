import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The colors in app.css meet WCAG AA in both themes (design 8): 4.5:1 for text, and 3:1 for the
// outline of a text field (WCAG 1.4.11).

const css = readFileSync('src/app.css', 'utf8');

/** The color tokens set in the block that starts with this text. */
function tokens(start: string): Map<string, string> {
	const from = css.indexOf(start);
	const block = css.slice(from, css.indexOf('\n}\n', from));
	const found = block.matchAll(/(--[\w-]+): (#[0-9a-f]{6});/g);
	return new Map([...found].map(([, name, value]) => [name, value] as [string, string]));
}

// WCAG relative luminance of an sRGB color such as #faf5ec.
function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((at) => {
		const c = parseInt(hex.slice(at, at + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const BACKGROUNDS = ['--bg', '--surface', '--surface-sunk'];
const TEXT = ['--text', '--muted', '--accent', '--received', '--ordered', '--danger'];
// The token that text fields, selects and textareas are outlined with.
const fieldRule = /input,\s*select,\s*textarea \{[^}]*border: 1px solid var\((--[\w-]+)\)/.exec(css);
if (!fieldRule?.[1]) throw new Error('input, select and textarea have no border color');
const FIELD_BORDER = fieldRule[1];

describe.each([
	['light', tokens(':root {')],
	['dark', tokens('@media (prefers-color-scheme: dark)')]
])('the %s theme', (_, theme) => {
	function contrast(a: string, b: string): number {
		const [high, low] = [a, b]
			.map((name) => {
				const value = theme.get(name);
				if (value === undefined) throw new Error(`${name} is not set`);
				return luminance(value);
			})
			.sort((x, y) => y - x) as [number, number];
		return (high + 0.05) / (low + 0.05);
	}

	it('has text that meets 4.5:1 on every background', () => {
		for (const background of BACKGROUNDS) {
			for (const text of TEXT) {
				expect(contrast(text, background), `${text} on ${background}`).toBeGreaterThanOrEqual(4.5);
			}
		}
		expect(contrast('--on-accent', '--accent')).toBeGreaterThanOrEqual(4.5);
	});

	it('outlines fields at 3:1 on every background', () => {
		for (const background of BACKGROUNDS) {
			expect(
				contrast(FIELD_BORDER, background),
				`${FIELD_BORDER} on ${background}`
			).toBeGreaterThanOrEqual(3);
		}
	});
});
