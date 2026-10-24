// Reading CSV files, as spreadsheets save them (RFC 4180): commas between cells, and a cell with
// commas, quotes or line breaks in double quotes, with its quotes doubled.

/**
 * The file's rows, each a list of cells as text. Lines may end in \n or \r\n, a byte order mark
 * at the start is dropped, and a line break at the end of the file doesn't start another row.
 */
export function parseCsv(text: string): string[][] {
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
		} else if (char === '"') quoted = true;
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
	if (cell !== '' || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}
	return rows;
}
