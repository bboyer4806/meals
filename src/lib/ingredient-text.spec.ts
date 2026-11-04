import { describe, expect, it } from 'vitest';
import { splitIngredient } from './ingredient-text.ts';

describe('splitIngredient', () => {
	it('splits an amount, a known unit, an item and a prep note', () => {
		expect(splitIngredient('1 1/2 cups flour, sifted')).toEqual({
			amount: '1 1/2',
			unit: 'cups',
			item: 'flour',
			prepNote: 'sifted'
		});
	});

	it('takes a common unit', () => {
		expect(splitIngredient('2 cloves garlic')).toEqual({
			amount: '2',
			unit: 'cloves',
			item: 'garlic',
			prepNote: ''
		});
		expect(splitIngredient('1 pinch salt').unit).toBe('pinch');
		expect(splitIngredient('2 sticks butter').unit).toBe('sticks');
	});

	it('starts the item at any other word', () => {
		expect(splitIngredient('3 eggs')).toEqual({ amount: '3', unit: '', item: 'eggs', prepNote: '' });
		expect(splitIngredient('2 large eggs').item).toBe('large eggs');
	});

	it('takes two-word units', () => {
		expect(splitIngredient('4 fl oz cream')).toMatchObject({ unit: 'fl oz', item: 'cream' });
	});

	it('takes T., t., Tb and TB as known units (MEA-77)', () => {
		expect(splitIngredient('1 T. butter')).toEqual({
			amount: '1',
			unit: 'T.',
			item: 'butter',
			prepNote: ''
		});
		expect(splitIngredient('1 t. vanilla')).toMatchObject({ unit: 't.', item: 'vanilla' });
		expect(splitIngredient('2 Tb flour')).toMatchObject({ unit: 'Tb', item: 'flour' });
		expect(splitIngredient('2 TB flour')).toMatchObject({ unit: 'TB', item: 'flour' });
	});

	it('leaves out an "of" after the unit (MEA-74)', () => {
		expect(splitIngredient('2 cloves of garlic')).toEqual({
			amount: '2',
			unit: 'cloves',
			item: 'garlic',
			prepNote: ''
		});
		expect(splitIngredient('1 Cup Of milk').item).toBe('milk');
		// Only right after the unit.
		expect(splitIngredient('2 cups cream of mushroom soup').item).toBe('cream of mushroom soup');
	});

	it('reads a unit written onto the amount (MEA-74)', () => {
		expect(splitIngredient('500g flour')).toEqual({
			amount: '500',
			unit: 'g',
			item: 'flour',
			prepNote: ''
		});
		expect(splitIngredient('1/2cup sugar')).toMatchObject({ amount: '1/2', unit: 'cup' });
		expect(splitIngredient('1 1/2cups flour')).toMatchObject({ amount: '1 1/2', unit: 'cups' });
		expect(splitIngredient('2-3tbsp oil')).toMatchObject({ unit: 'tbsp', prepNote: '2 to 3' });
		// Letters that aren't a unit aren't split off.
		expect(splitIngredient('7UP soda')).toEqual({
			amount: '',
			unit: '',
			item: '7UP soda',
			prepNote: ''
		});
	});

	it('puts text in parentheses after the amount or the unit in the prep note (MEA-74)', () => {
		expect(splitIngredient('1 (14 oz) can of diced tomatoes, drained')).toEqual({
			amount: '1',
			unit: 'can',
			item: 'diced tomatoes',
			prepNote: '14 oz, drained'
		});
		expect(splitIngredient('2 (6 oz) salmon fillets')).toEqual({
			amount: '2',
			unit: '',
			item: 'salmon fillets',
			prepNote: '6 oz'
		});
		expect(splitIngredient('1 cup (240 ml) milk')).toMatchObject({
			unit: 'cup',
			item: 'milk',
			prepNote: '240 ml'
		});
	});

	it('reads no amount or unit without a number first', () => {
		expect(splitIngredient('Salt, to taste')).toEqual({
			amount: '',
			unit: '',
			item: 'Salt',
			prepNote: 'to taste'
		});
		expect(splitIngredient('cup of tea').unit).toBe('');
	});

	it('puts a range in the prep note', () => {
		expect(splitIngredient('2-3 cloves garlic')).toEqual({
			amount: '2',
			unit: 'cloves',
			item: 'garlic',
			prepNote: '2 to 3'
		});
		expect(splitIngredient('1 to 2 tbsp oil, warmed')).toEqual({
			amount: '1',
			unit: 'tbsp',
			item: 'oil',
			prepNote: '1 to 2, warmed'
		});
	});

	it('reads "1-1/2" and fraction characters as one amount', () => {
		expect(splitIngredient('1-1/2 cups milk')).toMatchObject({ amount: '1-1/2', prepNote: '' });
		expect(splitIngredient('1½ tsp salt')).toMatchObject({ amount: '1½', unit: 'tsp' });
		expect(splitIngredient('½ onion')).toMatchObject({ amount: '½', item: 'onion' });
	});

	it('leaves the item empty after an amount and unit alone', () => {
		expect(splitIngredient('2 cups')).toEqual({ amount: '2', unit: 'cups', item: '', prepNote: '' });
	});
});
