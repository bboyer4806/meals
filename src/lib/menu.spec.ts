import { describe, expect, it } from 'vitest';
import {
	addDays,
	daysBetween,
	hasDishes,
	isDate,
	leaveQuestion,
	partyListNameFor,
	weekDates,
	weekStart
} from './menu.ts';

describe('dates', () => {
	it('reads only real dates written YYYY-MM-DD', () => {
		expect(isDate('2026-10-07')).toBe(true);
		expect(isDate('2028-02-29')).toBe(true);
		expect(isDate('2026-02-29')).toBe(false);
		expect(isDate('2026-13-01')).toBe(false);
		expect(isDate('2026-10-7')).toBe(false);
		expect(isDate('10/07/2026')).toBe(false);
		expect(isDate('')).toBe(false);
	});

	it('adds days across months, years and daylight saving changes', () => {
		expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
		// US clocks change on Mar 8 and Nov 1, 2026; calendar days don't.
		expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
		expect(addDays('2026-10-31', 2)).toBe('2026-11-02');
		expect(daysBetween('2026-10-07', '2026-10-13')).toBe(6);
		expect(daysBetween('2026-10-13', '2026-10-07')).toBe(-6);
		expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
	});

	it('refuses something that is not a date', () => {
		expect(() => addDays('soon', 1)).toThrow('Not a date: soon');
	});
});

describe('weeks', () => {
	it('start on Sunday (Q27b)', () => {
		// Oct 4, 2026 is a Sunday.
		expect(weekStart('2026-10-04')).toBe('2026-10-04');
		expect(weekStart('2026-10-07')).toBe('2026-10-04');
		expect(weekStart('2026-10-10')).toBe('2026-10-04');
		expect(weekStart('2026-10-11')).toBe('2026-10-11');
		expect(weekStart('2027-01-01')).toBe('2026-12-27');
	});

	it('list seven days', () => {
		expect(weekDates('2026-12-27')).toEqual([
			'2026-12-27',
			'2026-12-28',
			'2026-12-29',
			'2026-12-30',
			'2026-12-31',
			'2027-01-01',
			'2027-01-02'
		]);
	});
});

describe('dinner types', () => {
	it('give dishes only to Cooking at home and Bringing a dish (Q26)', () => {
		expect(hasDishes('cook')).toBe(true);
		expect(hasDishes('going')).toBe(true);
		expect(hasDishes('eat_out')).toBe(false);
		expect(hasDishes('leftovers')).toBe(false);
	});
});

describe('party lists', () => {
	it("start a dinner's new list with its label, or Party without one, and its date (6.15)", () => {
		expect(partyListNameFor(null, '2026-12-05')).toBe('Party Sat Dec 5');
		expect(partyListNameFor('Adults', '2027-01-03')).toBe('Adults Sun Jan 3');
	});
});

describe('leaving a date', () => {
	it('asks without saving, or names a dish typed, when no dinner has a label (MEA-127)', () => {
		const unsaved = { label: null, unsaved: 'note', dish: '' } as const;
		expect(leaveQuestion([unsaved])).toBe('Leave without saving? What you typed may be lost.');
		expect(leaveQuestion([{ ...unsaved, unsaved: 'changes', dish: 'Garlic bread' }])).toBe(
			'Leave without adding Garlic bread? What you typed may be lost.'
		);
		// Forms kept for dinners someone cleared, on a date with none left (MEA-256).
		expect(
			leaveQuestion([
				{ ...unsaved, dish: 'Garlic bread' },
				unsaved,
				{ ...unsaved, unsaved: null, dish: 'Salsa' }
			])
		).toBe('Leave without adding Garlic bread and Salsa? What you typed may be lost.');
	});

	it('names each dinner with something typed on a date with more than one (MEA-126)', () => {
		expect(leaveQuestion([{ label: 'Adults', unsaved: 'note', dish: '' }])).toBe(
			"Adults has a note you haven't saved. Leave anyway?"
		);
		expect(
			leaveQuestion([
				{ label: 'Kids', unsaved: 'changes', dish: '' },
				{ label: 'Adults', unsaved: null, dish: 'Garlic bread' },
				{ label: 'Guests', unsaved: 'note', dish: 'Salsa' }
			])
		).toBe(
			"Kids has changes you haven't saved. Adults has Garlic bread you haven't added. " +
				"Guests has a note you haven't saved and Salsa you haven't added. Leave anyway?"
		);
	});
});
