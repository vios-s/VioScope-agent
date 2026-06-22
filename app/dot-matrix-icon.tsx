'use client';

import { useId, type SVGProps } from 'react';

// Adapted from icantcodefyi/dot-matrix-animations (MIT): same 5x5 SVG idea,
// vendored as a tiny subset because the upstream project is not published as an npm package.
const grid = 5;
const pad = 6;
const spacing = 11;
const viewBox = pad * 2 + spacing * (grid - 1);
const dotBaseRadius = 2.4;
const dotLitRadius = 3.1;
const center = (grid - 1) / 2;

type DotMatrixVariant = 'thinking' | 'stream' | 'loading' | 'idle';

type Pattern = {
  title: string;
  blurb: string;
  durationMs: number;
  easing: string;
  keyframes: string;
  delay: (col: number, row: number) => number;
};

const patterns: Pattern[] = [
  {
    title: 'Thinking',
    blurb: 'Inner cluster fires like neurons while the field rests.',
    durationMs: 1800,
    easing: 'ease-in-out',
    keyframes: '0%{opacity:0.05;}30%{opacity:0.05;}40%{opacity:1;}55%{opacity:0.10;}100%{opacity:0.05;}',
    delay: (col, row) => (Math.abs(col - center) <= 1 && Math.abs(row - center) <= 1 ? (col + row) / 10 : -1),
  },
  {
    title: 'Stream',
    blurb: 'Tokens emit in reading order, top-left to bottom-right.',
    durationMs: 2400,
    easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
    keyframes: '0%{opacity:0;}8%{opacity:1;}22%{opacity:0.05;}100%{opacity:0;}',
    delay: (col, row) => (row * grid + col) / (grid * grid),
  },
  {
    title: 'Loading',
    blurb: 'A trailing spinner sweeps the outer ring.',
    durationMs: 2000,
    easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
    keyframes: '0%{opacity:0;}4%{opacity:1;}26%{opacity:0.08;}100%{opacity:0;}',
    delay: (col, row) => {
      const ring = [
        [0, 0], [1, 0], [2, 0], [3, 0], [4, 0],
        [4, 1], [4, 2], [4, 3], [4, 4], [3, 4],
        [2, 4], [1, 4], [0, 4], [0, 3], [0, 2], [0, 1],
      ];
      const index = ring.findIndex(([nextCol, nextRow]) => nextCol === col && nextRow === row);
      return index < 0 ? -1 : index / ring.length;
    },
  },
  {
    title: 'Verify',
    blurb: 'A checkmark traces itself once and stays lit.',
    durationMs: 1400,
    easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    keyframes: '0%{opacity:0;}5%{opacity:1;}30%{opacity:0.05;}80%{opacity:0.05;}100%{opacity:0.6;}',
    delay: (col, row) => {
      const path = [[0, 2], [1, 3], [2, 4], [3, 3], [4, 2], [4, 1], [4, 0]];
      const index = path.findIndex(([nextCol, nextRow]) => nextCol === col && nextRow === row);
      return index < 0 ? -1 : index / path.length;
    },
  },
];

const variantIconIndex: Record<DotMatrixVariant, number> = {
  thinking: 0,
  stream: 1,
  loading: 2,
  idle: 3,
};

function dotPosition(col: number, row: number): [number, number] {
  return [pad + col * spacing, pad + row * spacing];
}

function wrapIcon(iconIndex: number) {
  return ((iconIndex % patterns.length) + patterns.length) % patterns.length;
}

export interface DotMatrixIconProps extends Omit<SVGProps<SVGSVGElement>, 'color'> {
  iconIndex?: number;
  variant?: DotMatrixVariant;
  size?: number;
  color?: string;
  baseColor?: string;
  autoPlay?: boolean;
  speedMultiplier?: number;
}

export function DotMatrixIcon({
  iconIndex,
  variant,
  size = 56,
  color = 'currentColor',
  baseColor,
  autoPlay,
  speedMultiplier = 1,
  style,
  ...props
}: DotMatrixIconProps) {
  const pattern = patterns[wrapIcon(iconIndex ?? variantIconIndex[variant || 'thinking'])];
  const rawId = useId();
  const id = `dm-${rawId.replace(/:/g, '')}`;
  const shouldAnimate = autoPlay ?? variant !== 'idle';
  const speed = speedMultiplier > 0 ? speedMultiplier : 1;
  const duration = Math.round(pattern.durationMs / speed);
  const animation = shouldAnimate ? `${id}-kf ${duration}ms ${pattern.easing} infinite both` : 'none';
  const restOpacity = shouldAnimate ? 0 : 0.62;
  const rules: string[] = [
    `.${id}-bg{fill:${baseColor ?? color};opacity:.07;}`,
    `.${id}-lit{fill:${color};opacity:${restOpacity};animation:${animation};}`,
    `@keyframes ${id}-kf{${pattern.keyframes}}`,
    `@media (prefers-reduced-motion: reduce){.${id}-lit{animation:none;opacity:.45;}}`,
  ];
  const dots = [];

  for (let row = 0; row < grid; row += 1) {
    for (let col = 0; col < grid; col += 1) {
      const [cx, cy] = dotPosition(col, row);
      const delay = pattern.delay(col, row);
      dots.push(<circle key={`bg-${row}-${col}`} className={`${id}-bg`} cx={cx} cy={cy} r={dotBaseRadius} />);
      if (delay < 0) continue;

      const className = `${id}-d${row}${col}`;
      rules.push(`.${className}{animation-delay:${Math.round((delay * pattern.durationMs) / speed)}ms;}`);
      dots.push(<circle key={`lit-${row}-${col}`} className={`${id}-lit ${className}`} cx={cx} cy={cy} r={dotLitRadius} />);
    }
  }

  return (
    <svg
      aria-label={pattern.title}
      className="dot-matrix-svg"
      role="img"
      viewBox={`0 0 ${viewBox} ${viewBox}`}
      width={size}
      height={size}
      {...props}
      style={style}
    >
      <title>{pattern.title}</title>
      <desc>{pattern.blurb}</desc>
      <style>{rules.join('\n')}</style>
      {dots}
    </svg>
  );
}
