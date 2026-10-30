'use client';

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { skeletonFigureCaptionLimit, skeletonFigureLimit, skeletonFigureMaxBytes, skeletonFigureTypes, type SkeletonFigure } from '../src/mastra/submission/skeleton-figures';

export type FigureDraft = { key: string; file: File; caption: string };

function FigurePreview({ file, index }: { file: File; index: number }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const value = URL.createObjectURL(file); setUrl(value); return () => URL.revokeObjectURL(value); }, [file]);
  return url ? <img src={url} alt={`Figure ${index + 1} upload preview`} /> : null;
}

export function SkeletonFigureUploads({ figures, onChange }: { figures: FigureDraft[]; onChange: (figures: FigureDraft[]) => void }) {
  const [error, setError] = useState('');
  return <div className="skeleton-figure-uploads">
    <label>Figure images
      <input type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={figures.length >= skeletonFigureLimit} aria-describedby="skeleton-figure-help skeleton-figure-error" onChange={event => {
        const files = Array.from(event.target.files || []); event.target.value = ''; setError('');
        if (files.length + figures.length > skeletonFigureLimit) { setError('Upload at most 4 figure images.'); return; }
        if (files.some(file => !skeletonFigureTypes.includes(file.type) || !file.size || file.size > skeletonFigureMaxBytes)) { setError('Choose PNG, JPEG or WebP images, each non-empty and at most 5 MB.'); return; }
        onChange([...figures, ...files.map(file => ({ key: crypto.randomUUID(), file, caption: '' }))]);
      }} />
    </label>
    <p id="skeleton-figure-help" className="checklist-hint">Up to 4 PNG/JPEG/WebP images · 5 MB and 16 MP each · Captions required. Images and captions save with the check; unsaved entries are lost on leaving or reloading.</p>
    <p id="skeleton-figure-error" className="form-message error" role="alert">{error}</p>
    <div className="skeleton-figure-list">
      {figures.map((figure, index) => <figure key={figure.key} className="skeleton-figure">
        <div className="skeleton-figure-heading"><strong>Figure {index + 1}</strong><button className="ops-secondary" type="button" aria-label={`Remove figure ${index + 1}`} onClick={() => { setError(''); onChange(figures.filter(item => item.key !== figure.key)); }}><Trash2 aria-hidden="true" />Remove</button></div>
        <FigurePreview file={figure.file} index={index} />
        <figcaption>{figure.file.name}</figcaption>
        <label htmlFor={`skeleton-caption-${figure.key}`}>Caption for figure {index + 1}</label>
        <textarea id={`skeleton-caption-${figure.key}`} required rows={3} maxLength={skeletonFigureCaptionLimit} value={figure.caption} onChange={event => onChange(figures.map(item => item.key === figure.key ? { ...item, caption: event.target.value } : item))} />
      </figure>)}
    </div>
  </div>;
}

export function SavedSkeletonFigures({ figures }: { figures: SkeletonFigure[] }) {
  return <div className="skeleton-figure-list" aria-label="Reviewed figure images">
    {figures.map((figure, index) => <figure key={figure.id} className="skeleton-figure">
      <strong>Figure {index + 1} <span className="checklist-hint">({figure.id})</span></strong>
      <img src={figure.dataUrl} alt={`Figure ${index + 1}: ${figure.caption}`} loading="lazy" />
      <figcaption><strong>{figure.name}</strong><p>{figure.caption}</p></figcaption>
    </figure>)}
  </div>;
}
