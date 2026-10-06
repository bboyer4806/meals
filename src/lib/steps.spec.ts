import { describe, expect, it } from 'vitest';
import { splitSteps, stepHasUnscaledAmount } from './steps.ts';

describe('splitSteps', () => {
	it('gives one trimmed step per line, skipping blank lines', () => {
		expect(splitSteps('  Preheat the oven. \n\n   \nMix.\r\nBake.\rCool.')).toEqual([
			'Preheat the oven.',
			'Mix.',
			'Bake.',
			'Cool.'
		]);
	});

	it('has no steps for no text', () => {
		expect(splitSteps(null)).toEqual([]);
		expect(splitSteps('')).toEqual([]);
		expect(splitSteps(' \n ')).toEqual([]);
	});

	it('drops step numbers and bullets that people type, since steps are shown numbered', () => {
		const text = '1. Preheat.\n2) Mix.\nStep 3: Bake.\nStep 4 - Cool.\n- Slice.\n* Serve.\n• Eat.';
		expect(splitSteps(text)).toEqual([
			'Preheat.',
			'Mix.',
			'Bake.',
			'Cool.',
			'Slice.',
			'Serve.',
			'Eat.'
		]);
		expect(splitSteps('Step 1\nPreheat.\n2.')).toEqual(['Preheat.']);
	});

	it('keeps numbers that start a step', () => {
		const steps = ['2 eggs go in next.', '1.5 cups of the milk.', '1/2 the dough.', '10:30 start.'];
		expect(splitSteps(steps.join('\n'))).toEqual(steps);
	});
});

describe('stepHasUnscaledAmount', () => {
	it('skips times and temperatures (change 2.1.3)', () => {
		expect(stepHasUnscaledAmount('Bake 25 to 30 minutes at 350°F.')).toBe(false);
		expect(stepHasUnscaledAmount('Bake at 350 degrees.')).toBe(false);
		expect(stepHasUnscaledAmount('Mix well.')).toBe(false);
	});

	it('finds amounts', () => {
		expect(stepHasUnscaledAmount('Add 2 eggs.')).toBe(true);
		expect(stepHasUnscaledAmount('Stir in 1 1/2 cups of milk.')).toBe(true);
		expect(stepHasUnscaledAmount('Season with ½ tsp salt.')).toBe(true);
		expect(stepHasUnscaledAmount('Add 1½ cups of stock.')).toBe(true);
		expect(stepHasUnscaledAmount('Fold in .5 cup of nuts.')).toBe(true);
		expect(stepHasUnscaledAmount('Divide into 12 balls.')).toBe(true);
		expect(stepHasUnscaledAmount('Pour into a 9x13 pan.')).toBe(true);
	});

	it('finds an amount next to a time and a temperature', () => {
		const step = 'Bake at 350°F for 25 to 30 minutes, then add 2 eggs.';
		expect(stepHasUnscaledAmount(step)).toBe(true);
		expect(stepHasUnscaledAmount('Add 2 cups of stock and simmer 10 minutes.')).toBe(true);
		expect(stepHasUnscaledAmount('Simmer 10 minutes, then add 1/2 cup of cream.')).toBe(true);
	});

	it('skips every time and temperature unit, ignoring case and with or without a space', () => {
		for (const unit of [
			'°',
			'degrees',
			'minutes',
			'minute',
			'min',
			'mins',
			'hours',
			'hour',
			'hr',
			'hrs',
			'seconds',
			'second',
			'sec',
			'secs'
		]) {
			expect(stepHasUnscaledAmount(`Wait 5 ${unit}.`), unit).toBe(false);
			expect(stepHasUnscaledAmount(`Wait 5${unit.toUpperCase()}.`), unit).toBe(false);
		}
		expect(stepHasUnscaledAmount('Bake at 350 °F.')).toBe(false);
		expect(stepHasUnscaledAmount('Heat to 165 Degrees F.')).toBe(false);
		expect(stepHasUnscaledAmount('Fry at 180°C.')).toBe(false);
	});

	it('skips ranges of times and temperatures', () => {
		expect(stepHasUnscaledAmount('Bake 25-30 min.')).toBe(false);
		expect(stepHasUnscaledAmount('Braise 2–3 hours.')).toBe(false);
		expect(stepHasUnscaledAmount('Bake 25 - 30 minutes.')).toBe(false);
		expect(stepHasUnscaledAmount('Bake 25 or 30 minutes.')).toBe(false);
		expect(stepHasUnscaledAmount('Bake between 25 and 30 minutes.')).toBe(false);
		expect(stepHasUnscaledAmount('Roast at 400-425°F.')).toBe(false);
		expect(stepHasUnscaledAmount('Bake 350 to 375 degrees.')).toBe(false);
	});

	it('skips times written with fractions and decimals', () => {
		expect(stepHasUnscaledAmount('Simmer 1.5 hours.')).toBe(false);
		expect(stepHasUnscaledAmount('Simmer 1 1/2 hours.')).toBe(false);
		expect(stepHasUnscaledAmount('Simmer 1-1/2 to 2 hours.')).toBe(false);
		expect(stepHasUnscaledAmount('Rest ½ hour.')).toBe(false);
		expect(stepHasUnscaledAmount('Rest 1½ hours.')).toBe(false);
		expect(stepHasUnscaledAmount('Rest 1 ½ hours.')).toBe(false);
		expect(stepHasUnscaledAmount('Bake 1 hour 15 minutes.')).toBe(false);
		expect(stepHasUnscaledAmount('Bake 1 hr 15 min.')).toBe(false);
	});

	it('skips other ways of writing times and temperatures', () => {
		expect(stepHasUnscaledAmount('Bake in a 350-degree oven.')).toBe(false);
		expect(stepHasUnscaledAmount('Give it a 10-minute rest.')).toBe(false);
		expect(stepHasUnscaledAmount('Bake 5 more minutes.')).toBe(false);
		expect(stepHasUnscaledAmount('Preheat to 350F.')).toBe(false);
		// Look-alikes of the degree sign that phones and keyboards offer.
		expect(stepHasUnscaledAmount('Bake at 350ºF.')).toBe(false);
		expect(stepHasUnscaledAmount('Bake at 350˚F.')).toBe(false);
		expect(stepHasUnscaledAmount('Marinate 2 days.')).toBe(false);
	});

	it('only skips whole time words', () => {
		expect(stepHasUnscaledAmount('Add 2 minced cloves of garlic.')).toBe(true);
		expect(stepHasUnscaledAmount('Add 3 secret spices.')).toBe(true);
		expect(stepHasUnscaledAmount('Add 2 fl oz of cream.')).toBe(true);
		expect(stepHasUnscaledAmount('Add 2 to the bowl.')).toBe(true);
		expect(stepHasUnscaledAmount('Tear 2 day-old baguettes into cubes.')).toBe(true);
	});

	it('ignores a step number people typed', () => {
		expect(stepHasUnscaledAmount('1. Preheat the oven to 350°F.')).toBe(false);
		expect(stepHasUnscaledAmount('Step 2: Mix.')).toBe(false);
		expect(stepHasUnscaledAmount('3) Add 2 eggs.')).toBe(true);
		expect(stepHasUnscaledAmount('1.5 cups of milk go in.')).toBe(true);
	});
});
