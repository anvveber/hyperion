import { describe, it, expect } from 'vitest';
import { computeHops, computeElevations, elevationFor, hashUnit } from '@/components/graph/elevation';
import type { SimulationEdge, SimulationNode } from '@/components/graph/simulation-types';

const person = (id: string, isCenter = false): SimulationNode => ({
  kind: 'person', id, label: id, groups: [], colors: [], isCenter,
});
const edge = (source: string, target: string): SimulationEdge => ({
  source, target, type: 'friend', color: '#fff',
});

describe('hashUnit', () => {
  it('is stable and within [0, 1)', () => {
    expect(hashUnit('abc')).toBe(hashUnit('abc'));
    for (const id of ['', 'a', 'user-1', 'person-xyz']) {
      const v = hashUnit(id);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('computeHops', () => {
  it('counts hops from the center in both edge directions', () => {
    const nodes = [person('me', true), person('a'), person('b'), person('c'), person('lonely')];
    const edges = [edge('me', 'a'), edge('b', 'a'), edge('c', 'b')];
    const hops = computeHops(nodes, edges);
    expect(hops.get('me')).toBe(0);
    expect(hops.get('a')).toBe(1);
    expect(hops.get('b')).toBe(2);
    expect(hops.get('c')).toBe(3);
    expect(hops.has('lonely')).toBe(false);
  });
});

describe('elevation', () => {
  it('puts the center highest and each hop lower', () => {
    const nodes = [person('me', true), person('a'), person('b')];
    const { elevation } = computeElevations(nodes, [edge('me', 'a'), edge('a', 'b')]);
    const me = elevation.get('me') ?? 0;
    const a = elevation.get('a') ?? 0;
    const b = elevation.get('b') ?? 0;
    expect(me).toBeGreaterThan(a);
    expect(a).toBeGreaterThan(b);
  });

  it('treats unconnected people like the farthest level', () => {
    expect(elevationFor(person('x'), undefined)).toBeLessThan(elevationFor(person('x'), 1));
  });
});
