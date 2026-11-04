// Reading CSV files, as spreadsheets save them (RFC 4180): commas between cells, and a cell with
// commas, quotes or line breaks in double quotes, with its quotes doubled. As in a spreadsheet, a
// quote opens a quoted cell only at the start of a cell and is text anywhere else, so Use a 9" pan
// keeps its inch mark (design 7, MEA-72).

/**
 * The file's rows, each a list of cells as text, or the row (counting from 1) where a cell starts
 * with a quote the file never closes. That cell would hold the rest of the file.
 */
export type CsvResult =
	| { kind: 'rows'; rows: string[][] }
	| { kind: 'unclosed-quote'; row: number };

/**
 * Reads a CSV file. Lines may end in \n or \r\n, a byte order mark at the start is dropped, and
 * a line break at the end of the file doesn't start another row.
 */
export function parseCsv(text: string): CsvResult {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	let i = text.startsWith('﻿') ? 1 : 0;
	for (; i < text.length; i++) {
		const char = text[i];
		if (quoted) {
			if (char !== '"') cell += char;
			else if (text[i + 1] === '"') {
				cell += '"';
				i++;
			} else quoted = false;
		} else if (char === '"' && cell === '') quoted = true;
		else if (char === ',') {
			row.push(cell);
			cell = '';
		} else if (char === '\n' || char === '\r') {
			if (char === '\r' && text[i + 1] === '\n') i++;
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
		} else cell += char;
	}
	// A line break in quotes belongs to the cell, so the quote opened on the row being read.
	if (quoted) return { kind: 'unclosed-quote', row: rows.length + 1 };
	if (cell !== '' || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}
	return { kind: 'rows', rows };
}
