import { useSyncExternalStore } from 'react';
import type { LayerId } from './layers.tsx';

// One selection shared by the 3D stage, the 2D journey, the layer stack and the inspector.
export type Selection = { kind: 'layer'; layer: LayerId } | { kind: 'device'; id: string };

let current: Selection = { kind: 'layer', layer: 'transport' };
const subs = new Set<() => void>();

export const selection = {
  get: () => current,
  set(next: Selection) {
    if (next.kind === current.kind && (next.kind === 'layer' ? next.layer === (current as typeof next).layer : next.id === (current as typeof next).id)) return;
    current = next;
    for (const f of subs) f();
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => subs.delete(f);
  },
};

export const useSelection = () => useSyncExternalStore(selection.subscribe, selection.get);
