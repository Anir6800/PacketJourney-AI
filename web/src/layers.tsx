import type { LayerId } from '@packetjourney/shared';

// Layer identity without hue: label + code + distinct glyph shape + line style (LAYER_LINE).
export type { LayerId };

export const LAYERS: Record<LayerId, { name: string; code: string; pdu: string; teachingOnly?: true }> = {
  app: { name: 'Application', code: 'APP', pdu: 'message' },
  transport: { name: 'Transport', code: 'TRN', pdu: 'segment / datagram' },
  internet: { name: 'Internet', code: 'NET', pdu: 'packet' },
  link: { name: 'Link', code: 'LNK', pdu: 'frame' },
  physical: { name: 'Physical (teaching view)', code: 'PHY', pdu: 'bits', teachingOnly: true },
};

const shapes: Record<LayerId, React.ReactNode> = {
  app: <polygon points="12,2 22,12 12,22 2,12" />,
  transport: <polygon points="12,2 21,7 21,17 12,22 3,17 3,7" />,
  internet: <circle cx="12" cy="12" r="9" />,
  link: <rect x="2" y="5" width="20" height="14" rx="2" />,
  physical: <path d="M2 12c2.5-6 5-6 7.5 0s5 6 7.5 0 3.5-4 5-2" />,
};

/** SVG line style per layer: APP solid core, TRN dashed, NET frosted fill, LNK double (callers draw the inner line), PHY dotted bits. */
export const LAYER_LINE: Record<LayerId, React.SVGProps<SVGRectElement & SVGCircleElement>> = {
  app: { fill: 'var(--c-text)', stroke: 'var(--c-text)' },
  transport: { fill: 'none', stroke: 'var(--c-text)', strokeDasharray: '5 4' },
  internet: { fill: 'rgba(255,255,255,0.08)', stroke: 'var(--c-text)', strokeOpacity: 0.6 },
  link: { fill: 'none', stroke: 'var(--c-text)' },
  physical: { fill: 'none', stroke: 'var(--c-text)', strokeDasharray: '1 5', strokeLinecap: 'round' },
};

export function LayerGlyph({ layer, size = 18 }: { layer: LayerId; size?: number }) {
  return (
    <svg
      className="glyph"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={`var(--c-${layer})`}
      strokeWidth="2.2"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes[layer]}
    </svg>
  );
}
