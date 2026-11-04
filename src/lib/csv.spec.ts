import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv.ts';

describe('parseCsv', () => {
	it('splits rows and cells', () => {
		expect(parseCsv('a,b,c\n1,2,3\n')).toEqual({
			kind: 'rows',
			rows: [
				['a', 'b', 'c'],
				['1', '2', '3']
			]
		});
	});

	it('reads quoted cells with commas, doubled quotes and line breaks', () => {
		expect(parseCsv('"1 cup flour, sifted","Say ""when""","one\r\ntwo"\r\nx')).toEqual({
			kind: 'rows',
			rows: [['1 cup flour, sifted', 'Say "when"', 'one\r\ntwo'], ['x']]
		});
	});

	it("keeps a quote that doesn't start a cell as text", () => {
		expect(parseCsv('Pan,Use a 9" pan\r\nTin,"8"" tin" or a 9" pan\r\n')).toEqual({
			kind: 'rows',
			rows: [
				['Pan', 'Use a 9" pan'],
				['Tin', '8" tin or a 9" pan']
			]
		});
	});

	it('keeps empty cells and drops a byte order mark', () => {
		expect(parseCsv('﻿Recipe,,Notes\r\n,,\r\n')).toEqual({
			kind: 'rows',
			rows: [
				['Recipe', '', 'Notes'],
				['', '', '']
			]
		});
	});

	it('reads a last row without a line break, and nothing as no rows', () => {
		expect(parseCsv('a\nb')).toEqual({ kind: 'rows', rows: [['a'], ['b']] });
		expect(parseCsv('')).toEqual({ kind: 'rows', rows: [] });
	});

	it('gives the row where a quote that is never closed opens', () => {
		// Row 2's quoted cell holds a line break, so row 3 starts on the file's fourth line.
		expect(parseCsv('Recipe,Notes\nSoup,"Hot\nor cold"\nToast,"Butter\nRice,Plain\n')).toEqual({
			kind: 'unclosed-quote',
			row: 3
		});
	});
});
