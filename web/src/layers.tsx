import type { LayerId } from '@packetjourney/shared';

// Layer identity: colour token + label + code + distinct glyph shape. Colour is never the only signal.
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
