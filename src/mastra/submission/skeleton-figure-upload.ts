import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { skeletonFigureCaptionLimit, skeletonFigureLimit, skeletonFigureMaxBytes, skeletonFigureTypes, type SkeletonFigure } from './skeleton-figures';

/** Bound multipart parsing too, including requests without Content-Length. Existing decks allow 25 MB. */
export async function readSkeletonForm(request: Request) {
  const maxBytes = 28 * 1024 * 1024;
  if (Number(request.headers.get('content-length')) > maxBytes) throw new Error('The upload request exceeds 28 MB.');
  if (!request.body) throw new Error('Provide a skeleton check.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('The upload request exceeds 28 MB.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Response(Buffer.concat(chunks), { headers: { 'content-type': request.headers.get('content-type') || '' } }).formData();
}

export async function readSkeletonFigures(form: FormData, mode: string): Promise<SkeletonFigure[]> {
  const files = form.getAll('figures');
  const captions = form.getAll('figureCaptions');
  if (!files.length && !captions.length) return [];
  if (mode !== 'blocks') throw new Error('Figure images are supported only in the skeleton sections form.');
  if (files.length > skeletonFigureLimit) throw new Error('Upload at most 4 figure images.');
  if (files.length !== captions.length) throw new Error('Provide one caption for each figure image.');
  const figures: SkeletonFigure[] = [];
  for (const [index, file] of files.entries()) {
    if (!(file instanceof File) || !file.size || file.size > skeletonFigureMaxBytes) throw new Error('Each figure image must be non-empty and at most 5 MB.');
    if (!skeletonFigureTypes.includes(file.type)) throw new Error('Figure images must be PNG, JPEG or WebP.');
    const caption = z.string().trim().min(1, 'Enter a caption for each figure image.').max(skeletonFigureCaptionLimit, 'Keep each figure caption within 2,000 characters.').parse(captions[index]);
    const input = Buffer.from(await file.arrayBuffer());
    const decoder = sharp(input, { limitInputPixels: 16_777_216, failOn: 'warning' });
    let output;
    try {
      const metadata = await decoder.metadata();
      const mime = ({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' } as Record<string, string>)[metadata.format || ''];
      if (mime !== file.type || (metadata.pages ?? 1) !== 1) throw new Error('Unsupported image');
      // Fully decode and strip metadata; retain the original resolution and EXIF orientation.
      output = await decoder.rotate().png().toBuffer({ resolveWithObject: true });
    } catch {
      throw new Error('Use a valid, non-animated PNG, JPEG or WebP image of at most 16 megapixels.');
    }
    if (output.data.length > skeletonFigureMaxBytes) throw new Error('The decoded figure exceeds 5 MB as PNG. Export a smaller image and try again.');
    figures.push({ id: `figure:${index + 1}`, name: file.name.split(/[\\/]/).at(-1)!.slice(0, 180), caption,
      dataUrl: `data:image/png;base64,${output.data.toString('base64')}`, width: output.info.width, height: output.info.height,
      sha256: createHash('sha256').update(output.data).digest('hex') });
  }
  return figures;
}
