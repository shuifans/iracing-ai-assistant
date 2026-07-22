'use client';

import { useId } from 'react';

interface LogoMarkProps {
  className?: string;
}

export function LogoMark({ className = 'h-7 w-7' }: LogoMarkProps) {
  const clipId = `pokeball-clip-${useId().replace(/:/g, '')}`;
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <circle cx="16" cy="16" r="15" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <circle cx="16" cy="16" r="15" fill="#2A75BB" />
        <path d="M1 16 A15 15 0 0 1 31 16 L1 16 Z" fill="#FFFFFF" />
        <rect x="0" y="14.6" width="32" height="2.8" fill="#00203F" />
      </g>
      <circle cx="16" cy="16" r="15" fill="none" stroke="#00203F" strokeWidth="1.4" />
      <circle cx="16" cy="16" r="4.6" fill="#FFFFFF" stroke="#00203F" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="2.4" fill="#FFCB05" />
    </svg>
  );
}
