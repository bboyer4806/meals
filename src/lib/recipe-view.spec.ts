import { describe, expect, it } from 'vitest';
import {
	MAX_SERVINGS,
	formatMinutes,
	groupBySection,
	nutritionFacts,
	parseRecipeId,
	servingsLabel,
	sourceLink,
	targetServings,
	totalMinutes
} from './recipe-view.ts';

describe('formatMinutes', () => {
	it('shows minutes under an hour', () => {
		expect(formatMinutes(45)).toBe('45 min');
		expect(formatMinutes(1)).toBe('1 min');
		expect(formatMinutes(0)).toBe('0 min');
		expect(formatMinutes(59)).toBe('59 min');
	});

	it('shows whole hours without minutes', () => {
		expect(formatMinutes(60)).toBe('1 hr');
		expect(formatMinutes(120)).toBe('2 hr');
	});

	it('shows hours and minutes', () => {
		expect(formatMinutes(75)).toBe('1 hr 15 min');
		expect(formatMinutes(61)).toBe('1 hr 1 min');
		expect(formatMinutes(10_000)).toBe('166 hr 40 min');
	});
});

describe('totalMinutes', () => {
	it('adds prep and cook time', () => {
		expect(totalMinutes(15, 60)).toBe(75);
	});

	it('counts a missing time as none', () => {
		expect(totalMinutes(null, 30)).toBe(30);
		expect(totalMinutes(20, null)).toBe(20);
		expect(totalMinutes(0, null)).toBe(0);
	});

	it('is null when neither is set', () => {
		expect(totalMinutes(null, null)).toBeNull();
	});
});

describe('targetServings', () => {
	it('uses a whole number from 1 to 100', () => {
		expect(targetServings('6', 4)).toBe(6);
		expect(targetServings('1', 4)).toBe(1);
		expect(targetServings(String(MAX_SERVINGS), 4)).toBe(100);
		expect(targetServings('4', 4)).toBe(4);
	});

	it("means the recipe's own servings for anything else", () => {
		const params = [null, '', '0', '101', '-2', '2.5', '1e1', 'abc', ' 6', '6 ', '0x10'];
		for (const param of [...params, '1'.repeat(30)]) expect(targetServings(param, 4)).toBe(4);
		expect(targetServings('500', 8)).toBe(8);
	});
});

describe('servingsLabel', () => {
	it('says serving for one and servings otherwise', () => {
		expect(servingsLabel(1)).toBe('1 serving');
		expect(servingsLabel(2)).toBe('2 servings');
		expect(servingsLabel(12)).toBe('12 servings');
	});
});

describe('parseRecipeId', () => {
	it('reads a positive whole number', () => {
		expect(parseRecipeId('1')).toBe(1);
		expect(parseRecipeId('42')).toBe(42);
	});

	it("is null for anything that isn't an id", () => {
		const params = ['', '0', '-1', '1.5', 'abc', '1e3', '0x10', ' 1', '9007199254740993'];
		for (const param of params) expect(parseRecipeId(param)).toBeNull();
	});
});

describe('sourceLink', () => {
	it('links web addresses', () => {
		expect(sourceLink('https://example.com/pound-cake')).toBe('https://example.com/pound-cake');
		expect(sourceLink('http://example.com')).toBe('http://example.com');
		expect(sourceLink('HTTPS://EXAMPLE.COM')).toBe('HTTPS://EXAMPLE.COM');
	});

	it('leaves anything else as text', () => {
		for (const source of [
			'Joy of Cooking, page 512',
			'Grandma',
			'www.example.com',
			'example.com/cake',
			'ftp://example.com/cake',
			'javascript:alert(1)',
			'https:example.com'
		]) {
			expect(sourceLink(source)).toBeNull();
		}
	});
});

describe('groupBySection', () => {
	const row = (id: number, section: string | null) => ({ id, section });

	it('is empty for no ingredients', () => {
		expect(groupBySection([])).toEqual([]);
	});

	it('puts everything in one group when there are no headings', () => {
		expect(groupBySection([row(1, null), row(2, null)])).toEqual([
			{ section: null, rows: [row(1, null), row(2, null)] }
		]);
	});

	it('starts a group wherever the section changes, keeping the order', () => {
		const rows = [row(1, null), row(2, 'Sauce'), row(3, 'Sauce'), row(4, 'Topping')];
		expect(groupBySection(rows)).toEqual([
			{ section: null, rows: [row(1, null)] },
			{ section: 'Sauce', rows: [row(2, 'Sauce'), row(3, 'Sauce')] },
			{ section: 'Topping', rows: [row(4, 'Topping')] }
		]);
	});

	it('shows a heading again when the same section comes back later', () => {
		const rows = [row(1, 'Cake'), row(2, 'Frosting'), row(3, 'Cake')];
		const sections = groupBySection(rows).map((group) => group.section);
		expect(sections).toEqual(['Cake', 'Frosting', 'Cake']);
	});
});

describe('nutritionFacts', () => {
	const none = { calories: null, proteinG: null, carbsG: null, fatG: null };

	it('is empty when nothing was entered', () => {
		expect(nutritionFacts(none)).toEqual([]);
	});

	it('lists only what was entered, in a fixed order, with grams', () => {
		expect(nutritionFacts({ ...none, fatG: 15, calories: 320 })).toEqual([
			{ label: 'Calories', value: '320' },
			{ label: 'Fat', value: '15 g' }
		]);
		expect(nutritionFacts({ calories: 410, proteinG: 12.5, carbsG: 40, fatG: 9 })).toEqual([
			{ label: 'Calories', value: '410' },
			{ label: 'Protein', value: '12.5 g' },
			{ label: 'Carbs', value: '40 g' },
			{ label: 'Fat', value: '9 g' }
		]);
	});

	it('shows a zero that was entered', () => {
		expect(nutritionFacts({ ...none, fatG: 0 })).toEqual([{ label: 'Fat', value: '0 g' }]);
	});
});
