// components/graph/camera.ts
//
// Pure projection math for the 3D graph view.
//
// The force simulation stays 2D (x, y). Each node also gets an elevation z.
// The camera orbits a pivot point: `yaw` turns the graph around the vertical
// axis, `pitch` tilts the floor away from the viewer (0 = straight top-down),
// and `lift` scales every elevation (0 = flat, 1 = full height).
//
// project() maps a world point to a "flat" point P in the same units as the
// simulation. The d3-zoom transform is then applied to P as before
// (screen = P * k + t), so zoom and pan keep working unchanged.

export interface Camera {
  yaw: number;
  pitch: number;
  lift: number;
  /** Perspective distance in world units. Larger means weaker perspective. */
  distance: number;
  /** Orbit pivot in simulation coordinates. */
  pivotX: number;
  pivotY: number;
}

export interface Projected {
  x: number;
  y: number;
  /** Perspective scale factor: >1 is closer to the viewer. */
  scale: number;
  /** Signed distance toward the viewer. Higher is nearer. */
  depth: number;
}

const MIN_DENOMINATOR_RATIO = 0.15;

export function project(cam: Camera, x: number, y: number, z: number): Projected {
  const dx = x - cam.pivotX;
  const dy = y - cam.pivotY;
  const cosYaw = Math.cos(cam.yaw);
  const sinYaw = Math.sin(cam.yaw);
  const rx = dx * cosYaw - dy * sinYaw;
  const ry = dx * sinYaw + dy * cosYaw;

  const zl = z * cam.lift;
  const cosP = Math.cos(cam.pitch);
  const sinP = Math.sin(cam.pitch);
  const viewY = ry * cosP - zl * sinP;
  const depth = ry * sinP + zl * cosP;

  const denominator = Math.max(cam.distance - depth, cam.distance * MIN_DENOMINATOR_RATIO);
  const scale = cam.distance / denominator;

  return {
    x: cam.pivotX + rx * scale,
    y: cam.pivotY + viewY * scale,
    scale,
    depth,
  };
}

/**
 * Inverse of project() for a point known to sit at elevation z.
 * Returns null when the ray from the camera never meets that plane
 * (pointing above the horizon).
 */
export function unprojectToPlane(
  cam: Camera,
  px: number,
  py: number,
  z: number,
): { x: number; y: number } | null {
  const u = px - cam.pivotX;
  const v = py - cam.pivotY;
  const zl = z * cam.lift;
  const cosP = Math.cos(cam.pitch);
  const sinP = Math.sin(cam.pitch);
  const D = cam.distance;

  const denominator = D * cosP + v * sinP;
  if (denominator <= 1e-6) return null;
  const ry = (v * D - v * zl * cosP + D * zl * sinP) / denominator;

  const perspective = D - ry * sinP - zl * cosP;
  if (perspective <= 1e-6) return null;
  const scale = D / perspective;
  const rx = u / scale;

  const cosYaw = Math.cos(cam.yaw);
  const sinYaw = Math.sin(cam.yaw);
  return {
    x: cam.pivotX + rx * cosYaw + ry * sinYaw,
    y: cam.pivotY - rx * sinYaw + ry * cosYaw,
  };
}

/** Move `current` toward `target` with frame-rate independent smoothing. */
export function approach(current: number, target: number, dtSeconds: number, rate: number): number {
  const t = 1 - Math.exp(-dtSeconds * rate);
  return current + (target - current) * t;
}

/** The multiple of 2*PI closest to `angle`, so a reset never spins the long way round. */
export function nearestFullTurn(angle: number): number {
  return Math.round(angle / (Math.PI * 2)) * Math.PI * 2;
}
