// Recipe photos are resized on the phone before upload (design 2.3), so uploads stay small and
// the server never decodes an image (photos.ts only checks and stores them). Browser only.

const PHOTO = { longestSide: 1600, quality: 0.85 };
const THUMB = { longestSide: 400, quality: 0.8 };

const UNREADABLE = "This photo couldn't be read. Try a JPEG or PNG.";

/**
 * Resizes a chosen photo for upload: the photo to at most 1600 px on its longest side and the
 * thumbnail to at most 400 px, both JPEG. A smaller photo keeps its size. preview is the
 * thumbnail as a data: URL to show before saving, since the Content Security Policy allows
 * data: images but not blob: ones.
 */
export async function resizePhoto(
	file: File
): Promise<{ photo: Blob; thumb: Blob; preview: string }> {
	const bitmap = await decode(file);
	try {
		const full = scaled(bitmap, PHOTO.longestSide);
		// From the resized photo rather than the original: a smaller step down looks smoother.
		const small = scaled(full, THUMB.longestSide);
		const photo = await jpeg(full, PHOTO.quality);
		const thumb = await jpeg(small, THUMB.quality);
		return { photo, thumb, preview: await dataUrl(thumb) };
	} finally {
		bitmap.close();
	}
}

async function decode(file: File): Promise<ImageBitmap> {
	try {
		// Turned upright by the camera's orientation tag, which the new JPEG won't have.
		return await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(
			(e: unknown) => {
				// Older browsers reject that option, so decode without it there.
				if (e instanceof TypeError) return createImageBitmap(file);
				throw e;
			}
		);
	} catch {
		throw new Error(UNREADABLE);
	}
}

/** A canvas with the image scaled down so its longest side is at most `longestSide` px. */
function scaled(source: ImageBitmap | HTMLCanvasElement, longestSide: number): HTMLCanvasElement {
	const scale = Math.min(1, longestSide / Math.max(source.width, source.height));
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(source.width * scale));
	canvas.height = Math.max(1, Math.round(source.height * scale));
	const context = canvas.getContext('2d');
	if (!context) throw new Error(UNREADABLE);
	// JPEG has no transparency, and transparent parts of a PNG would turn black.
	context.fillStyle = '#fff';
	context.fillRect(0, 0, canvas.width, canvas.height);
	context.imageSmoothingQuality = 'high';
	context.drawImage(source, 0, 0, canvas.width, canvas.height);
	return canvas;
}

function jpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error(UNREADABLE))),
			'image/jpeg',
			quality
		);
	});
}

function dataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error ?? new Error(UNREADABLE));
		reader.readAsDataURL(blob);
	});
}
