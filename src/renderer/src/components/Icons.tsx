// Thin-stroke icon set drawn for the app (1.4px strokes, 20px grid).
import type { SVGProps } from 'react'

const base = (p: SVGProps<SVGSVGElement>) => ({ width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, ...p })

export const IconMap = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="10" cy="10" r="7.2" />
    <ellipse cx="10" cy="10" rx="7.2" ry="2.6" transform="rotate(-24 10 10)" />
    <circle cx="10" cy="10" r="1.3" fill="currentColor" stroke="none" />
  </svg>
)
export const IconTimeline = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M2.5 10h15" />
    <path d="M5.5 6.5v7M10 4.5v11M14.5 7.5v5" />
  </svg>
)
export const IconCharacters = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3" y="3.2" width="9.5" height="13.6" rx="1.8" />
    <path d="M14.8 5.2l1.5.4a1.6 1.6 0 0 1 1.1 2l-2.6 9.3" />
    <circle cx="7.75" cy="8.2" r="2" />
    <path d="M4.9 13.8c.6-1.6 1.6-2.4 2.85-2.4s2.25.8 2.85 2.4" />
  </svg>
)
export const IconFiles = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M5 2.8h6.3L15 6.5v10.7H5z" />
    <path d="M11.2 2.8v3.8H15M7.6 10h4.8M7.6 13h4.8" />
  </svg>
)
export const IconClose = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 16, height: 16, ...p })}>
    <path d="M5 5l10 10M15 5L5 15" />
  </svg>
)
export const IconPanel = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 16, height: 16, ...p })}>
    <rect x="3" y="3.5" width="14" height="13" rx="2" />
    <path d="M12.5 3.5v13" />
  </svg>
)
export const IconTarget = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 14, height: 14, ...p })}>
    <circle cx="10" cy="10" r="6" />
    <path d="M10 1.5v4M10 14.5v4M1.5 10h4M14.5 10h4" />
  </svg>
)
export const IconFolder = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 14, height: 14, ...p })}>
    <path d="M2.8 5.2a1.4 1.4 0 0 1 1.4-1.4h3.4l1.7 1.9h6.5a1.4 1.4 0 0 1 1.4 1.4v7.6a1.4 1.4 0 0 1-1.4 1.4H4.2a1.4 1.4 0 0 1-1.4-1.4z" />
  </svg>
)
