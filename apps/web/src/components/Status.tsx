import { Lock } from 'lucide-react';
import type { Status } from '@swu-tcc/core';
import { STATUS_LABEL } from '../format.ts';

const svgProps = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

/** Status icon: lucide `lock` for LOCKED, brand custom icons (docs/brand/icons) for the rest. */
export function StatusIcon({ status, size = 20 }: { status: Status; size?: number }) {
  const common = { 'data-status-icon': status, width: size, height: size };
  switch (status) {
    case 'locked':
      return <Lock {...common} aria-hidden="true" />;
    case 'id-safe':
      return (
        <svg {...svgProps} {...common}>
          <path d="M12 3 19 6v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6Z" />
          <path d="M9 10.5h6" />
          <path d="M9 14h6" />
        </svg>
      );
    case 'bubble':
      return (
        <svg {...svgProps} {...common}>
          <circle cx="12" cy="12" r="6" />
          <path d="M2 12h20" />
        </svg>
      );
    case 'win-and-in':
      return (
        <svg {...svgProps} {...common}>
          <path d="M12 20V5" />
          <path d="m7 10 5-5 5 5" />
          <path d="M3 15h4" />
          <path d="M17 15h4" />
        </svg>
      );
    case 'out':
      return (
        <svg {...svgProps} {...common}>
          <path d="M3 7h4" />
          <path d="M10 7h4" />
          <path d="M17 7h4" />
          <path d="M12 11v9" />
          <path d="m8 16 4 4 4-4" />
        </svg>
      );
  }
}

export function StatusChip({ status }: { status: Status }) {
  return (
    <span className={`chip st-${status}`}>
      <StatusIcon status={status} size={16} />
      <span>{STATUS_LABEL[status]}</span>
    </span>
  );
}
