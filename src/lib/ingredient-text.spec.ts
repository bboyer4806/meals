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
