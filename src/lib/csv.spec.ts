import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv.ts';

describe('parseCsv', () => {
	it('splits rows and cells', () => {
		expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
			['a', 'b', 'c'],
			['1', '2', '3']
		]);
	});

	it('reads quoted cells with commas, doubled quotes and line breaks', () => {
		expect(parseCsv('"1 cup flour, sifted","Say ""when""","one\r\ntwo"\r\nx')).toEqual([
			['1 cup flour, sifted', 'Say "when"', 'one\r\ntwo'],
			['x']
		]);
	});

	it('keeps empty cells and drops a byte order mark', () => {
		expect(parseCsv('﻿Recipe,,Notes\r\n,,\r\n')).toEqual([
			['Recipe', '', 'Notes'],
			['', '', '']
		]);
	});

	it('reads a last row without a line break, and nothing as no rows', () => {
		expect(parseCsv('a\nb')).toEqual([['a'], ['b']]);
		expect(parseCsv('')).toEqual([]);
	});
});
