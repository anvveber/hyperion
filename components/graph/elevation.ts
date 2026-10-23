// components/graph/elevation.ts
//
// Gives every node a height for the 3D view. Height follows the number of
// hops from the center node, so "you" floats on top and each ring of
// connections sits a level lower. A small per-node offset (stable, derived
// from the id) keeps nodes on the same level from forming a flat sheet.

import type { SimulationEdge, SimulationNode } from './simulation-types';

export const GROUND_Z = -70;

const LEVEL_Z = [90, 30, 0, -25] as const;
const JITTER_Z = 16;

/** Stable pseudo-random number in [0, 1) from a string (FNV-1a). */
export function hashUnit(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}

function endpointId(v: string | SimulationNode): string {
  return typeof v === 'string' ? v : v.id;
}

/** Breadth-first hop count from the center node(s). Unreached nodes get no entry. */
export function computeHops(nodes: SimulationNode[], edges: SimulationEdge[]): Map<string, number> {
  const adjacency = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = adjacency.get(a);
    if (list) list.push(b);
    else adjacency.set(a, [b]);
  };
  for (const e of edges) {
    const s = endpointId(e.source);
    const t = endpointId(e.target);
    link(s, t);
    link(t, s);
  }

  const hops = new Map<string, number>();
  const queue: string[] = [];
  for (const n of nodes) {
    if (n.kind === 'person' && n.isCenter) {
      hops.set(n.id, 0);
      queue.push(n.id);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    const next = (hops.get(id) ?? 0) + 1;
    for (const neighbor of adjacency.get(id) ?? []) {
      if (hops.has(neighbor)) continue;
      hops.set(neighbor, next);
      queue.push(neighbor);
    }
  }
  return hops;
}

/** Elevation for one node, given its hop count (undefined = not connected). */
export function elevationFor(node: SimulationNode, hop: number | undefined): number {
  if (node.kind === 'person' && node.isCenter) return LEVEL_Z[0];
  const jitter = (hashUnit(node.id) - 0.5) * 2 * JITTER_Z;
  if (node.kind === 'bubble') return (node.isExpanded ? LEVEL_Z[2] : LEVEL_Z[1]) + jitter * 0.5;
  const level = hop === undefined ? LEVEL_Z.length - 1 : Math.min(hop, LEVEL_Z.length - 1);
  return LEVEL_Z[level] + jitter;
}

export function computeElevations(
  nodes: SimulationNode[],
  edges: SimulationEdge[],
): { elevation: Map<string, number>; hops: Map<string, number> } {
  const hops = computeHops(nodes, edges);
  const elevation = new Map<string, number>();
  for (const n of nodes) elevation.set(n.id, elevationFor(n, hops.get(n.id)));
  return { elevation, hops };
}
