import { describe, it, expect } from 'vitest';
import { createShapeForce, spreadRatio } from '@/components/graph/shape-force';
import type { SimulationNode } from '@/components/graph/simulation-types';

const ring = (count: number): SimulationNode[] =>
  Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return {
      kind: 'person', id: `p${i}`, label: '', groups: [], colors: [], isCenter: false,
      x: Math.cos(a) * 100, y: Math.sin(a) * 100, vx: 0, vy: 0,
    } satisfies SimulationNode;
  });

/** Apply the force and integrate velocities, like a bare simulation would. */
function run(nodes: SimulationNode[], target: number, ticks: number): void {
  const force = createShapeForce(() => target, () => ({ x: 0, y: 0 }));
  force.initialize(nodes);
  for (let t = 0; t < ticks; t++) {
    force(0.5);
    for (const n of nodes) {
      n.x = (n.x ?? 0) + (n.vx ?? 0);
      n.y = (n.y ?? 0) + (n.vy ?? 0);
      n.vx = (n.vx ?? 0) * 0.4;
      n.vy = (n.vy ?? 0) * 0.4;
    }
  }
}

describe('spreadRatio', () => {
  it('is 1 for a circle and null for too few nodes', () => {
    expect(spreadRatio(ring(12), 0, 0)).toBeCloseTo(1);
    expect(spreadRatio(ring(3), 0, 0)).toBeNull();
  });
});

describe('createShapeForce', () => {
  it('stretches a circle into a tall shape', () => {
    const nodes = ring(24);
    run(nodes, 1.8, 200);
    expect(spreadRatio(nodes, 0, 0)).toBeGreaterThan(1.6);
  });

  it('stretches a circle into a wide shape', () => {
    const nodes = ring(24);
    run(nodes, 0.6, 200);
    expect(spreadRatio(nodes, 0, 0)).toBeLessThan(0.66);
  });

  it('leaves the center node and pinned nodes alone', () => {
    const nodes = ring(12);
    nodes[0] = { ...nodes[0], isCenter: true } as SimulationNode;
    nodes[1].fx = nodes[1].x;
    const force = createShapeForce(() => 2, () => ({ x: 0, y: 0 }));
    force.initialize(nodes);
    force(1);
    expect(nodes[0].vx).toBe(0);
    expect(nodes[1].vx).toBe(0);
    expect(nodes[2].vx).not.toBe(0);
  });
});
