import { afterEach, describe, expect, it, vi } from 'vitest';
import { resizePhoto } from './photo-resize.ts';

// Tests run in Node, so the browser APIs resizePhoto uses are faked here: just enough to check
// the sizes, the JPEG settings and the order of the drawing.

type Size = { width: number; height: number };

class FakeContext {
	fillStyle = '';
	imageSmoothingQuality = '';
	canvas: FakeCanvas;

	constructor(canvas: FakeCanvas) {
		this.canvas = canvas;
	}

	fillRect(x: number, y: number, width: number, height: number) {
		this.canvas.painted.push(`fill ${this.fillStyle} ${width}x${height}`);
	}

	drawImage(source: Size, x: number, y: number, width: number, height: number) {
		const from = `${source.width}x${source.height}`;
		this.canvas.painted.push(`draw ${from} as ${width}x${height} (${this.imageSmoothingQuality})`);
	}
}

class FakeCanvas {
	width = 0;
	height = 0;
	painted: string[] = [];

	getContext(type: string) {
		return type === '2d' ? new FakeContext(this) : null;
	}

	/** The "JPEG" says what it was made from. */
	toBlob(done: (blob: Blob | null) => void, type: string, quality: number) {
		done(new Blob([`${this.width}x${this.height} at ${quality}`], { type }));
	}
}

class FakeFileReader {
	result: string | null = null;
	error: Error | null = null;
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;

	readAsDataURL(blob: Blob) {
		void blob.arrayBuffer().then((buffer) => {
			this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;
			this.onload?.();
		});
	}
}

const FILE = new File(['camera bytes'], 'IMG_0001.jpg', { type: 'image/jpeg' });

/** Fakes a browser that decodes every photo to an image of this size. */
function browser({ width, height }: Size) {
	const bitmap = { width, height, close: vi.fn() };
	const decode = vi.fn(async (_file: File, _options?: ImageBitmapOptions) => bitmap);
	const canvases: FakeCanvas[] = [];
	vi.stubGlobal('createImageBitmap', decode);
	vi.stubGlobal('document', {
		createElement: (tag: string) => {
			expect(tag).toBe('canvas');
			const canvas = new FakeCanvas();
			canvases.push(canvas);
			return canvas;
		}
	});
	vi.stubGlobal('FileReader', FakeFileReader);
	return { bitmap, decode, canvases };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

async function sizes(original: Size) {
	browser(original);
	const { photo, thumb } = await resizePhoto(FILE);
	return [await photo.text(), await thumb.text()];
}

describe('resizePhoto', () => {
	it('scales a big photo to 1600 px and its thumbnail to 400 px on the longest side', async () => {
		expect(await sizes({ width: 4032, height: 3024 })).toEqual([
			'1600x1200 at 0.85',
			'400x300 at 0.8'
		]);
		expect(await sizes({ width: 3024, height: 4032 })).toEqual([
			'1200x1600 at 0.85',
			'300x400 at 0.8'
		]);
		expect(await sizes({ width: 5000, height: 5000 })).toEqual([
			'1600x1600 at 0.85',
			'400x400 at 0.8'
		]);
		// Rounded to whole pixels, and never thinner than one.
		expect(await sizes({ width: 3001, height: 1000 })).toEqual([
			'1600x533 at 0.85',
			'400x133 at 0.8'
		]);
		expect(await sizes({ width: 10000, height: 2 })).toEqual(['1600x1 at 0.85', '400x1 at 0.8']);
	});

	it('never makes a photo bigger', async () => {
		expect(await sizes({ width: 1000, height: 800 })).toEqual([
			'1000x800 at 0.85',
			'400x320 at 0.8'
		]);
		expect(await sizes({ width: 300, height: 200 })).toEqual([
			'300x200 at 0.85',
			'300x200 at 0.8'
		]);
	});

	it('makes JPEGs, with the thumbnail as a data: URL for the preview', async () => {
		browser({ width: 4032, height: 3024 });
		const { photo, thumb, preview } = await resizePhoto(FILE);
		expect(photo.type).toBe('image/jpeg');
		expect(thumb.type).toBe('image/jpeg');
		const base64 = Buffer.from('400x300 at 0.8').toString('base64');
		expect(preview).toBe(`data:image/jpeg;base64,${base64}`);
	});

	it('draws the upright photo on white, then the thumbnail from the photo', async () => {
		const { bitmap, decode, canvases } = browser({ width: 4032, height: 3024 });
		await resizePhoto(FILE);

		expect(decode).toHaveBeenCalledExactlyOnceWith(FILE, { imageOrientation: 'from-image' });
		expect(canvases.map((canvas) => canvas.painted)).toEqual([
			['fill #fff 1600x1200', 'draw 4032x3024 as 1600x1200 (high)'],
			['fill #fff 400x300', 'draw 1600x1200 as 400x300 (high)']
		]);
		expect(bitmap.close).toHaveBeenCalledOnce();
	});

	it("decodes without the orientation option where the browser doesn't know it", async () => {
		const { decode } = browser({ width: 800, height: 600 });
		decode.mockRejectedValueOnce(new TypeError("'from-image' is not a valid ImageOrientation"));

		const { photo } = await resizePhoto(FILE);

		expect(await photo.text()).toBe('800x600 at 0.85');
		expect(decode.mock.calls).toEqual([[FILE, { imageOrientation: 'from-image' }], [FILE]]);
	});

	it("says so when the browser can't read the photo", async () => {
		const message = "This photo couldn't be read. Try a JPEG or PNG.";
		const { decode } = browser({ width: 800, height: 600 });

		decode.mockRejectedValueOnce(new DOMException('The source image could not be decoded.'));
		await expect(resizePhoto(FILE)).rejects.toThrow(message);

		decode
			.mockRejectedValueOnce(new TypeError('unknown option'))
			.mockRejectedValueOnce(new DOMException('The source image could not be decoded.'));
		await expect(resizePhoto(FILE)).rejects.toThrow(message);
	});

	it('says so, and lets go of the image, when the browser cannot make the JPEG', async () => {
		const { bitmap } = browser({ width: 800, height: 600 });
		vi.spyOn(FakeCanvas.prototype, 'toBlob').mockImplementation((done) => done(null));

		await expect(resizePhoto(FILE)).rejects.toThrow("This photo couldn't be read.");
		expect(bitmap.close).toHaveBeenCalledOnce();
	});
});
