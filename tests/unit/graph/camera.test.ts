import { describe, it, expect } from 'vitest';
import { project, unprojectToPlane, approach, nearestFullTurn, type Camera } from '@/components/graph/camera';

const base: Camera = { yaw: 0, pitch: 0, lift: 1, distance: 1000, pivotX: 400, pivotY: 300 };

describe('project', () => {
  it('leaves points at height 0 unchanged in a flat, unrotated view', () => {
    const p = project(base, 520, 260, 0);
    expect(p.x).toBeCloseTo(520);
    expect(p.y).toBeCloseTo(260);
    expect(p.scale).toBeCloseTo(1);
  });

  it('maps the pivot onto itself from any angle', () => {
    const cam = { ...base, yaw: 1.3, pitch: 0.8 };
    const p = project(cam, 400, 300, 0);
    expect(p.x).toBeCloseTo(400);
    expect(p.y).toBeCloseTo(300);
  });

  it('draws raised nodes higher on screen when the floor is tilted', () => {
    const cam = { ...base, pitch: 0.9 };
    const low = project(cam, 400, 300, 0);
    const high = project(cam, 400, 300, 80);
    expect(high.y).toBeLessThan(low.y);
  });

  it('ignores height when lift is 0', () => {
    const cam = { ...base, pitch: 0.9, lift: 0 };
    const a = project(cam, 450, 320, 0);
    const b = project(cam, 450, 320, 80);
    expect(b.x).toBeCloseTo(a.x);
    expect(b.y).toBeCloseTo(a.y);
  });

  it('makes points nearer the viewer larger', () => {
    const cam = { ...base, pitch: 0.9 };
    const far = project(cam, 400, 100, 0);
    const near = project(cam, 400, 500, 0);
    expect(near.scale).toBeGreaterThan(far.scale);
    expect(near.depth).toBeGreaterThan(far.depth);
  });
});

describe('unprojectToPlane', () => {
  it('inverts project for a point on the given plane', () => {
    const cam: Camera = { ...base, yaw: 0.7, pitch: 0.9, lift: 0.8 };
    for (const [x, y, z] of [[520, 260, 0], [100, 640, 40], [400, 300, -70], [800, 50, 90]]) {
      const p = project(cam, x, y, z);
      const back = unprojectToPlane(cam, p.x, p.y, z);
      expect(back).not.toBeNull();
      expect(back?.x).toBeCloseTo(x, 6);
      expect(back?.y).toBeCloseTo(y, 6);
    }
  });

  it('returns null above the horizon', () => {
    const cam: Camera = { ...base, pitch: 1.2 };
    expect(unprojectToPlane(cam, 400, -5000, 0)).toBeNull();
  });
});

describe('approach', () => {
  it('moves part of the way and never overshoots', () => {
    const v = approach(0, 10, 0.1, 4);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(10);
  });
});

describe('nearestFullTurn', () => {
  it('rounds to the closest multiple of a full turn', () => {
    expect(nearestFullTurn(0.4)).toBeCloseTo(0);
    expect(nearestFullTurn(5.9)).toBeCloseTo(Math.PI * 2);
    expect(nearestFullTurn(-7)).toBeCloseTo(-Math.PI * 2);
  });
});
