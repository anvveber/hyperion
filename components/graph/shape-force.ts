// components/graph/shape-force.ts
//
// A d3-force force that steers the overall shape of the layout toward a
// target height/width ratio. Without it a force layout settles into a
// rough circle, which wastes most of a tall phone screen or a wide monitor.
//
// It measures the spread of the nodes around the center (standard
// deviation along x and along y), compares the ratio to the target, and
// nudges every node a little: inward along one axis, outward along the
// other. It works as a feedback loop, so it converges whatever the other
// forces are doing, and it does nothing once the shape is close enough.

import type { SimulationNode } from './simulation-types';

const STRENGTH = 0.45;
const MAX_STEP = 0.4;
const TOLERANCE = 0.03;

export interface ShapeForce {
  (alpha: number): void;
  initialize: (nodes: SimulationNode[]) => void;
}

/** Nodes that should neither count toward the shape nor be moved by it. */
function isAnchored(node: SimulationNode): boolean {
  if (node.fx != null || node.fy != null) return true;
  if (node.kind === 'person' && node.isCenter) return true;
  return node.kind === 'bubble' && node.isExpanded;
}

/** Height-to-width ratio of the node spread, or null when it can't be measured. */
export function spreadRatio(nodes: SimulationNode[], cx: number, cy: number): number | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const d of nodes) {
    if (d.x === undefined || d.y === undefined || isAnchored(d)) continue;
    sx += (d.x - cx) ** 2;
    sy += (d.y - cy) ** 2;
    n++;
  }
  if (n < 4 || sx <= 0 || sy <= 0) return null;
  return Math.sqrt(sy / sx);
}

export function createShapeForce(
  getTargetRatio: () => number,
  getCenter: () => { x: number; y: number },
): ShapeForce {
  let nodes: SimulationNode[] = [];

  const force = ((alpha: number) => {
    const { x: cx, y: cy } = getCenter();
    const ratio = spreadRatio(nodes, cx, cy);
    if (ratio === null) return;
    // Positive error: too wide for the target, so squeeze x and stretch y.
    const error = Math.log(getTargetRatio() / ratio);
    if (Math.abs(error) < TOLERANCE) return;
    const step = Math.max(-MAX_STEP, Math.min(MAX_STEP, error)) * STRENGTH * alpha;
    for (const d of nodes) {
      if (d.x === undefined || d.y === undefined || isAnchored(d)) continue;
      d.vx = (d.vx ?? 0) - (d.x - cx) * step;
      d.vy = (d.vy ?? 0) + (d.y - cy) * step;
    }
  }) as ShapeForce;

  force.initialize = (n: SimulationNode[]) => {
    nodes = n;
  };

  return force;
}
