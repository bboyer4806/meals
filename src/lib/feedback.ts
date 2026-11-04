// Feedback's limits, checked in the browser and on the server (design 7, "Feedback").

// The longest feedback message.
export const MAX_FEEDBACK = 2000;

// The largest screenshot: 3 MB, counted as phones show file sizes.
export const MAX_SCREENSHOT_BYTES = 3_000_000;

const SCREENSHOT_TOO_LARGE = 'That screenshot is over 3 MB. Choose a smaller one.';
export const NOT_PNG_OR_JPEG = 'The screenshot must be a PNG or JPEG.';

// Every PNG starts with the first bytes, and every JPEG with the second.
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

/**
 * A screenshot's type, read from its first bytes whatever its name or stated type says, or the
 * message for a file over 3 MB or one that isn't a PNG or JPEG.
 */
export async function screenshotType(
	file: Blob
): Promise<{ type: 'image/png' | 'image/jpeg' } | { problem: string }> {
	if (file.size > MAX_SCREENSHOT_BYTES) return { problem: SCREENSHOT_TOO_LARGE };
	const start = new Uint8Array(await file.slice(0, PNG.length).arrayBuffer());
	const startsWith = (signature: number[]) => signature.every((byte, i) => start[i] === byte);
	if (startsWith(PNG)) return { type: 'image/png' };
	if (startsWith(JPEG)) return { type: 'image/jpeg' };
	return { problem: NOT_PNG_OR_JPEG };
}
