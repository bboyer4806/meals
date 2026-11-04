import { describe, expect, it } from 'vitest';
import { MAX_SCREENSHOT_BYTES, screenshotType } from './feedback.ts';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

const TOO_LARGE = { problem: 'That screenshot is over 3 MB. Choose a smaller one.' };
const NOT_PNG_OR_JPEG = { problem: 'The screenshot must be a PNG or JPEG.' };

/** A file of `size` bytes that starts with `start`, with the name and type a browser gave it. */
function file(start: number[], size: number, name: string, type: string): File {
	const bytes = new Uint8Array(size);
	bytes.set(start);
	return new File([bytes], name, { type });
}

describe('screenshotType', () => {
	it('reads a PNG or a JPEG from its content', async () => {
		expect(await screenshotType(file(PNG, 100, 'shot.png', 'image/png'))).toEqual({
			type: 'image/png'
		});
		expect(await screenshotType(file(JPEG, 100, 'shot.jpg', 'image/jpeg'))).toEqual({
			type: 'image/jpeg'
		});
	});

	it('goes by the content, whatever the name or stated type says', async () => {
		expect(await screenshotType(file(JPEG, 100, 'shot.png', 'image/png'))).toEqual({
			type: 'image/jpeg'
		});
		expect(await screenshotType(file(PNG, 100, 'shot', ''))).toEqual({ type: 'image/png' });
		const page = new File(['<html>Not a picture</html>'], 'shot.png', { type: 'image/png' });
		expect(await screenshotType(page)).toEqual(NOT_PNG_OR_JPEG);
	});

	it('refuses other images, a cut-off PNG and an empty file', async () => {
		expect(await screenshotType(file(GIF, 100, 'shot.gif', 'image/gif'))).toEqual(NOT_PNG_OR_JPEG);
		expect(await screenshotType(file(PNG.slice(0, 4), 4, 'shot.png', 'image/png'))).toEqual(
			NOT_PNG_OR_JPEG
		);
		expect(await screenshotType(file([], 0, 'shot.png', 'image/png'))).toEqual(NOT_PNG_OR_JPEG);
	});

	it('takes up to 3 MB, 3,000,000 bytes, and refuses more', async () => {
		expect(MAX_SCREENSHOT_BYTES).toBe(3_000_000);
		expect(await screenshotType(file(PNG, 3_000_000, 'shot.png', 'image/png'))).toEqual({
			type: 'image/png'
		});
		expect(await screenshotType(file(PNG, 3_000_001, 'shot.png', 'image/png'))).toEqual(TOO_LARGE);
		expect(await screenshotType(file(GIF, 3_000_001, 'shot.gif', 'image/gif'))).toEqual(TOO_LARGE);
	});
});
