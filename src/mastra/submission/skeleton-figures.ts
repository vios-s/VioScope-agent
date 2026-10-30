export const skeletonFigureLimit = 4;
export const skeletonFigureMaxBytes = 5 * 1024 * 1024;
export const skeletonFigureCaptionLimit = 2000;
export const skeletonFigureTypes = ['image/png', 'image/jpeg', 'image/webp'];

/** Immutable, server-normalised input saved with the AI review; never model-generated. */
export type SkeletonFigure = {
  id: string;
  name: string;
  caption: string;
  dataUrl: string;
  width: number;
  height: number;
  sha256: string;
};
