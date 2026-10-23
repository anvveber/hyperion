// components/graph/scene-renderer.ts
//
// Paints the network graph as a 3D "operations table": a floor like the app background, nodes as lit spheres floating at their elevation, drop
// lines to the floor, glowing links with travelling pulses, and labels that
// skip themselves when they would overlap.
//
// Everything is drawn in screen space. Positions come from camera.project()
// followed by the d3-zoom transform. paintScene() returns where each node
// landed on screen so the component can hit-test against what was drawn.

import type { ZoomTransform } from 'd3-zoom';
import { makeProjector, type Camera, type Projector } from './camera';
import { GROUND_Z, hashUnit } from './elevation';
import type { LODTier, PhotoCacheEntry, SimulationEdge, SimulationNode } from './simulation-types';

export interface EdgeLabelParts {
  before: string;
  emphasis: string;
  after: string;
}

export interface SceneContext {
  ctx: CanvasRenderingContext2D;
  transform: ZoomTransform;
  camera: Camera;
  width: number;
  height: number;
  lod: LODTier;
  isDark: boolean;
  isMobile: boolean;
  /** Seconds, monotonic. Drives every animation. */
  time: number;
  reducedMotion: boolean;
  hoveredNodeId: string | null;
  /** Group highlighted from the legend; its members stay lit, others dim. */
  focusGroupId?: string | null;
  elevation: (id: string) => number;
  /** 0..1 entrance progress for a node (1 = fully in place). */
  appear: (id: string) => number;
  getPhoto: (id: string) => PhotoCacheEntry | undefined;
  formatEdgeLabel?: (edge: SimulationEdge) => EdgeLabelParts;
}

export interface NodePlacement {
  node: SimulationNode;
  x: number;
  y: number;
  radius: number;
  depth: number;
}

// Matches --font-mono in app/globals.css so graph labels read like the rest
// of the console UI.
const GRAPH_FONT = '"IBM Plex Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Cascadia Mono", "Roboto Mono", "DejaVu Sans Mono", "Liberation Mono", monospace';

const NODE_RADIUS = {
  desktop: { center: 11, normal: 7, bubble: 14 },
  mobile: { center: 9, normal: 6, bubble: 12 },
} as const;

const FONT_SIZE = {
  desktop: { center: 15, normal: 13 },
  mobile: { center: 14, normal: 12 },
} as const;

// How far labels may shrink when zoomed out. Phones shrink less, since a
// fitted 100+ person graph is zoomed far out there.
const LABEL_MIN_SCALE = { desktop: 0.85, mobile: 1 } as const;

const GRID_STEP = 160;
// Spacing of the floor's dot pattern; GRID_STEP is a multiple of it, and
// every GRID_STEP gets a plus mark, like the page background.
const PATTERN_STEP = 40;
const MAX_EDGE_LABELS = 8;
// Smallest on-screen dot radius, so zoomed-out graphs stay tappable and visible.
const MIN_SCREEN_RADIUS = { desktop: 3.5, mobile: 4.5 } as const;
const NEUTRAL_NODE = '#9CA3AF';

interface Palette {
  accent: string;
  accentRgb: string;
  center: string;
  label: string;
  labelHalo: string;
  grid: string;
  frame: string;
  chipBg: string;
}

function palette(isDark: boolean): Palette {
  return isDark
    ? {
        accent: '#D4A72C',
        accentRgb: '212,167,44',
        center: '#FFFFFF',
        label: '#E6E6E6',
        labelHalo: 'rgba(16,16,16,0.85)',
        grid: '255,255,255',
        frame: 'rgba(255,255,255,0.22)',
        chipBg: 'rgba(16,16,16,0.82)',
      }
    : {
        accent: '#6E5300',
        accentRgb: '110,83,0',
        center: '#161616',
        label: '#161616',
        labelHalo: 'rgba(255,255,255,0.9)',
        grid: '0,0,0',
        frame: 'rgba(0,0,0,0.25)',
        chipBg: 'rgba(255,255,255,0.88)',
      };
}

// ---------------------------------------------------------------------------
// Small helpers

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number): number => {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

function endpointId(v: string | SimulationNode): string {
  return typeof v === 'string' ? v : v.id;
}

function nodeColor(node: SimulationNode, pal: Palette): string {
  if (node.kind === 'bubble') return node.color ?? NEUTRAL_NODE;
  if (node.isCenter) return pal.center;
  return node.colors[0] ?? NEUTRAL_NODE;
}

function baseRadius(node: SimulationNode, isMobile: boolean): number {
  const table = isMobile ? NODE_RADIUS.mobile : NODE_RADIUS.desktop;
  if (node.kind === 'bubble') return table.bubble;
  return node.isCenter ? table.center : table.normal;
}

// Soft colored halo, pre-rendered once per color and reused as a sprite.
const glowCache = new Map<string, HTMLCanvasElement>();
function glowSprite(color: string): HTMLCanvasElement | null {
  const cached = glowCache.get(color);
  if (cached) return cached;
  if (typeof document === 'undefined') return null;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.9)');
  grad.addColorStop(0.25, 'rgba(0,0,0,0.45)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, size, size);
  glowCache.set(color, canvas);
  return canvas;
}

const textWidthCache = new Map<string, number>();
function textWidth(ctx: CanvasRenderingContext2D, font: string, text: string): number {
  const key = `${font}|${text}`;
  const cached = textWidthCache.get(key);
  if (cached !== undefined) return cached;
  ctx.font = font;
  const w = ctx.measureText(text).width;
  if (textWidthCache.size > 4000) textWidthCache.clear();
  textWidthCache.set(key, w);
  return w;
}

// ---------------------------------------------------------------------------
// Projection

/** Per-frame context: the inputs plus a projector built once for this camera. */
interface Frame extends SceneContext {
  proj: Projector;
}

interface ScreenPoint {
  x: number;
  y: number;
  scale: number;
  depth: number;
}

function toScreen(sc: Frame, x: number, y: number, z: number): ScreenPoint {
  const p = sc.proj(x, y, z);
  const t = sc.transform;
  return { x: p.x * t.k + t.x, y: p.y * t.k + t.y, scale: p.scale, depth: p.depth };
}

interface Placed extends NodePlacement {
  scale: number;
  color: string;
  alpha: number;
  appear: number;
  ground: ScreenPoint | null;
  dimmed: boolean;
}

// ---------------------------------------------------------------------------
// Layers

function drawBackdrop(sc: Frame, pal: Palette, pivot: ScreenPoint): void {
  const { ctx, width, height } = sc;
  const r = Math.max(width, height) * 0.7;
  const grad = ctx.createRadialGradient(pivot.x, pivot.y, 0, pivot.x, pivot.y, r);
  grad.addColorStop(0, `rgba(${pal.accentRgb},${sc.isDark ? 0.07 : 0.05})`);
  grad.addColorStop(1, `rgba(${pal.accentRgb},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

function drawFloor(sc: Frame, pal: Palette, worldRadius: number): void {
  const { ctx, camera } = sc;
  const cx = camera.pivotX;
  const cy = camera.pivotY;
  const z = GROUND_Z;
  // Keep the floor well inside the perspective distance: points that reach
  // behind the camera would project to huge coordinates and stall the canvas.
  const outer = clamp(
    Math.ceil((worldRadius + GRID_STEP * 0.75) / GRID_STEP) * GRID_STEP,
    GRID_STEP * 2,
    Math.min(GRID_STEP * 9, camera.distance * 0.6),
  );

  ctx.save();

  // Dot lattice fixed to the world, so it turns and tilts with the camera.
  // Spacing doubles when zoomed out, so the dots never crowd into a haze.
  let step = PATTERN_STEP;
  while (step * sc.transform.k < 10 && step < GRID_STEP) step *= 2;
  const bands = 4;
  const dots: Path2D[] = [];
  const marks: Path2D[] = [];
  for (let b = 0; b < bands; b++) {
    dots.push(new Path2D());
    marks.push(new Path2D());
  }
  const bandOf = (r: number): number => {
    const fade = 1 - (r / outer) * (r / outer);
    return Math.min(bands - 1, Math.floor(fade * bands));
  };
  const arm = 9;
  const n = Math.floor(outer / step);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const wx = i * step;
      const wy = j * step;
      const r = Math.hypot(wx, wy);
      if (r >= outer) continue;
      const band = bandOf(r);
      const isMark = wx % GRID_STEP === 0 && wy % GRID_STEP === 0;
      if (isMark) {
        const path = marks[band];
        const l = sc.proj(cx + wx - arm, cy + wy, z);
        const rr = sc.proj(cx + wx + arm, cy + wy, z);
        const t = sc.proj(cx + wx, cy + wy - arm, z);
        const bt = sc.proj(cx + wx, cy + wy + arm, z);
        const k = sc.transform;
        path.moveTo(l.x * k.k + k.x, l.y * k.k + k.y);
        path.lineTo(rr.x * k.k + k.x, rr.y * k.k + k.y);
        path.moveTo(t.x * k.k + k.x, t.y * k.k + k.y);
        path.lineTo(bt.x * k.k + k.x, bt.y * k.k + k.y);
      } else {
        const p = toScreen(sc, cx + wx, cy + wy, z);
        const size = clamp(1.3 * p.scale, 0.9, 2.2);
        dots[band].rect(p.x - size / 2, p.y - size / 2, size, size);
      }
    }
  }
  const dotAlpha = sc.isDark ? 0.26 : 0.24;
  const markAlpha = sc.isDark ? 0.3 : 0.28;
  ctx.lineWidth = 1;
  for (let b = 0; b < bands; b++) {
    const weight = (b + 1) / bands;
    ctx.fillStyle = `rgba(${pal.grid},${dotAlpha * weight})`;
    ctx.fill(dots[b]);
    ctx.strokeStyle = `rgba(${pal.grid},${markAlpha * weight})`;
    ctx.stroke(marks[b]);
  }

  // Edge of the table: one ring with bearing ticks, long every 30 degrees.
  const gridAlpha = sc.isDark ? 0.12 : 0.13;
  const segments = 96;
  ctx.beginPath();
  for (let s = 0; s <= segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    const p = toScreen(sc, cx + Math.cos(a) * outer, cy + Math.sin(a) * outer, z);
    if (s === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = `rgba(${pal.grid},${gridAlpha})`;
  ctx.stroke();

  ctx.strokeStyle = `rgba(${pal.grid},${gridAlpha * 1.3})`;
  ctx.beginPath();
  for (let deg = 0; deg < 360; deg += 5) {
    const a = (deg / 180) * Math.PI;
    const len = deg % 30 === 0 ? 18 : 7;
    const p0 = toScreen(sc, cx + Math.cos(a) * outer, cy + Math.sin(a) * outer, z);
    const p1 = toScreen(sc, cx + Math.cos(a) * (outer + len), cy + Math.sin(a) * (outer + len), z);
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
  }
  ctx.stroke();

  ctx.restore();
}

function drawStems(sc: Frame, placed: Placed[]): void {
  const { ctx } = sc;
  const lift = sc.camera.lift;
  if (lift < 0.05) return;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  for (const p of placed) {
    if (!p.ground) continue;
    const a = p.alpha * lift * (p.dimmed ? 0.3 : 1);
    ctx.globalAlpha = a * 0.28;
    ctx.strokeStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y + p.radius);
    ctx.lineTo(p.ground.x, p.ground.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // Footprints on the floor
  const flatten = Math.max(0.15, Math.cos(sc.camera.pitch));
  for (const p of placed) {
    if (!p.ground) continue;
    const rx = p.radius * 0.9 * (p.ground.scale / Math.max(p.scale, 0.01));
    ctx.globalAlpha = p.alpha * lift * (p.dimmed ? 0.15 : 0.4);
    ctx.strokeStyle = p.color;
    ctx.beginPath();
    ctx.ellipse(p.ground.x, p.ground.y, rx, rx * flatten, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

interface DrawnEdge {
  edge: SimulationEdge;
  from: Placed;
  to: Placed;
  progress: number;
  highlighted: boolean;
  /** Both ends belong to the group picked in the legend. */
  emphasized: boolean;
  fog: number;
  index: number;
}

function drawEdges(sc: Frame, edges: DrawnEdge[], dimActive: boolean): void {
  const { ctx } = sc;
  const widthBase = clamp(1.1 * sc.transform.k, 0.6, 1.6);
  ctx.save();
  ctx.lineCap = 'round';

  // Quiet edges first, additive in dark mode so crossings glow softly.
  if (sc.isDark) ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = widthBase;
  for (const d of edges) {
    if (d.highlighted) continue;
    const base = d.emphasized ? 0.45 : dimActive ? 0.05 : 0.2;
    ctx.globalAlpha = base * d.fog;
    ctx.strokeStyle = d.edge.color || '#999';
    const ex = d.from.x + (d.to.x - d.from.x) * d.progress;
    const ey = d.from.y + (d.to.y - d.from.y) * d.progress;
    ctx.beginPath();
    ctx.moveTo(d.from.x, d.from.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';

  // Highlighted edges with arrowheads
  for (const d of edges) {
    if (!d.highlighted) continue;
    const color = d.edge.color || '#999';
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = color;
    ctx.lineWidth = widthBase + 0.8;
    ctx.beginPath();
    ctx.moveTo(d.from.x, d.from.y);
    ctx.lineTo(d.to.x, d.to.y);
    ctx.stroke();

    const dx = d.to.x - d.from.x;
    const dy = d.to.y - d.from.y;
    const len = Math.hypot(dx, dy);
    if (len < d.to.radius + 8) continue;
    const ux = dx / len;
    const uy = dy / len;
    const tipX = d.to.x - ux * (d.to.radius + 2);
    const tipY = d.to.y - uy * (d.to.radius + 2);
    const size = 7;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - ux * size + uy * size * 0.5, tipY - uy * size - ux * size * 0.5);
    ctx.lineTo(tipX - ux * size - uy * size * 0.5, tipY - uy * size + ux * size * 0.5);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.restore();
}

function drawPulses(sc: Frame, edges: DrawnEdge[], dimActive: boolean): void {
  if (sc.reducedMotion) return;
  const { ctx } = sc;
  ctx.save();
  if (sc.isDark) ctx.globalCompositeOperation = 'lighter';
  // Each idle edge fires one pulse per cycle; the cycle stretches with the
  // number of edges so a big network does not turn into static noise.
  const cycle = 7 * Math.max(1, edges.length / 160);
  const travel = 1.5;
  for (const d of edges) {
    if (d.progress < 1) continue;
    const color = d.edge.color || '#999';
    const positions: number[] = [];
    if (d.highlighted) {
      const base = (sc.time * 0.6) % 1;
      positions.push(base, (base + 0.5) % 1);
    } else if (!dimActive || d.emphasized) {
      const local = (sc.time + hashUnit(`${d.index}:${d.from.node.id}`) * cycle) % cycle;
      if (local < travel) positions.push(easeOutCubic(local / travel));
    }
    for (const t of positions) {
      const x = d.from.x + (d.to.x - d.from.x) * t;
      const y = d.from.y + (d.to.y - d.from.y) * t;
      const fade = Math.sin(Math.PI * t);
      const r = d.highlighted ? 2.6 : 1.8;
      ctx.fillStyle = color;
      ctx.globalAlpha = fade * (d.highlighted ? 0.35 : 0.2) * d.fog;
      ctx.beginPath();
      ctx.arc(x, y, r * 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = fade * (d.highlighted ? 1 : 0.75) * d.fog;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawSphere(sc: Frame, p: Placed, pal: Palette): void {
  const { ctx } = sc;
  const { x, y, radius: r } = p;
  const node = p.node;

  // Halo
  const sprite = glowSprite(p.color);
  if (sprite) {
    ctx.globalAlpha = p.alpha * (sc.isDark ? 0.55 : 0.3) * (node.kind === 'person' && node.isCenter ? 1.4 : 1);
    const g = r * 3.4;
    ctx.drawImage(sprite, x - g, y - g, g * 2, g * 2);
  }
  ctx.globalAlpha = p.alpha;

  const photo = sc.lod !== 'dots' && node.kind === 'person' && node.photo ? sc.getPhoto(node.id) : undefined;
  if (photo instanceof HTMLImageElement) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = sc.isDark ? '#000000' : '#ffffff';
    ctx.fill();
    ctx.clip();
    ctx.drawImage(photo, x - r, y - r, r * 2, r * 2);
    ctx.restore();
    ctx.globalAlpha = p.alpha;
  } else {
    // Lit sphere: base color, then a highlight up-left and shade down-right.
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    const shade = ctx.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.1, x, y, r * 1.05);
    shade.addColorStop(0, 'rgba(255,255,255,0.7)');
    shade.addColorStop(0.35, 'rgba(255,255,255,0.08)');
    shade.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = shade;
    ctx.fill();
  }

  // Rim. Someone in several groups gets one arc per group color, so the
  // groups past the first are visible too, not just the fill.
  ctx.lineWidth = r > 9 ? 1.6 : 1.2;
  ctx.globalAlpha = p.alpha * 0.9;
  const groupColors = node.kind === 'person' && !node.isCenter ? [...new Set(node.colors)] : [];
  if (groupColors.length > 1) {
    const ringR = r + 1.5;
    ctx.lineWidth = Math.max(1.6, r * 0.28);
    const gap = groupColors.length > 4 ? 0.12 : 0.22;
    const span = (Math.PI * 2) / groupColors.length;
    groupColors.forEach((color, i) => {
      const a0 = -Math.PI / 2 + i * span + gap / 2;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, ringR, a0, a0 + span - gap);
      ctx.stroke();
    });
  } else {
    ctx.strokeStyle = node.kind === 'person' && node.isCenter ? pal.accent : p.color;
    ctx.beginPath();
    ctx.arc(x, y, r + 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawBubble(sc: Frame, p: Placed, pal: Palette): void {
  if (p.node.kind !== 'bubble') return;
  const { ctx } = sc;
  const node = p.node;
  const { x, y, radius: r } = p;
  const strength = node.isExpanded ? 0.4 : 1;

  const sprite = glowSprite(p.color);
  if (sprite && !node.isExpanded) {
    ctx.globalAlpha = p.alpha * (sc.isDark ? 0.4 : 0.22);
    const g = r * 2.8;
    ctx.drawImage(sprite, x - g, y - g, g * 2, g * 2);
  }

  ctx.globalAlpha = p.alpha * (node.isExpanded ? 0.06 : 0.18);
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = p.alpha * strength;
  ctx.lineWidth = 2;
  ctx.strokeStyle = p.color;
  ctx.stroke();

  // Outer segmented ring, slowly turning
  const spin = sc.reducedMotion ? 0 : sc.time * 0.35 + hashUnit(node.id) * 6;
  ctx.globalAlpha = p.alpha * strength * 0.6;
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const a0 = spin + (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.arc(x, y, r + 5, a0, a0 + Math.PI / 4);
    ctx.stroke();
  }

  if (sc.lod !== 'dots') {
    ctx.globalAlpha = p.alpha * (node.isExpanded ? 0.5 : 1);
    ctx.fillStyle = sc.isDark ? '#f3f4f6' : pal.label;
    ctx.font = `600 ${sc.isMobile ? 9 : 10}px ${GRAPH_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(node.memberCount), x, y);
  }
  ctx.globalAlpha = 1;
}

function drawCenterDecorations(sc: Frame, p: Placed, pal: Palette): void {
  const { ctx } = sc;
  const { x, y, radius: r } = p;
  ctx.save();
  ctx.globalAlpha = p.alpha;
  ctx.strokeStyle = pal.accent;

  // Expanding pulse ring
  if (!sc.reducedMotion) {
    const phase = (sc.time % 2.6) / 2.6;
    ctx.globalAlpha = p.alpha * (1 - phase) * 0.55;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, r * (1.4 + phase * 3), 0, Math.PI * 2);
    ctx.stroke();
  }

  const spin = sc.reducedMotion ? 0 : sc.time;

  // Dashed inner ring
  ctx.globalAlpha = p.alpha * 0.85;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.lineDashOffset = -spin * 8;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Three counter-rotating arcs
  ctx.globalAlpha = p.alpha * 0.7;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    const a0 = -spin * 0.5 + (i * Math.PI * 2) / 3;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.6, a0, a0 + Math.PI / 4);
    ctx.stroke();
  }
  ctx.restore();
}

function drawReticle(sc: Frame, p: Placed, pal: Palette): void {
  const { ctx } = sc;
  const s = p.radius + 7;
  const arm = Math.max(5, s * 0.45);
  ctx.save();
  ctx.strokeStyle = pal.accent;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const cx = p.x + sx * s;
    const cy = p.y + sy * s;
    ctx.moveTo(cx, cy - sy * arm);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx - sx * arm, cy);
  }
  ctx.stroke();
  ctx.restore();
}

function drawEdgeLabels(sc: Frame, edges: DrawnEdge[], pal: Palette): void {
  if (!sc.formatEdgeLabel || sc.lod === 'dots') return;
  const { ctx } = sc;
  const fontSize = sc.isMobile ? 10 : 11;
  const normalFont = `${fontSize}px ${GRAPH_FONT}`;
  const boldFont = `700 ${fontSize}px ${GRAPH_FONT}`;
  // A hub like "you" can have dozens of links; that many chips would just
  // pile up, so past a handful the names alone have to do.
  if (edges.filter((d) => d.highlighted).length > MAX_EDGE_LABELS) return;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const d of edges) {
    if (!d.highlighted) continue;
    const parts = sc.formatEdgeLabel(d.edge);
    if (!parts.before && !parts.emphasis && !parts.after) continue;
    const mx = (d.from.x + d.to.x) / 2;
    const my = (d.from.y + d.to.y) / 2;
    const wBefore = textWidth(ctx, normalFont, parts.before);
    const wEmph = textWidth(ctx, boldFont, parts.emphasis);
    const wAfter = textWidth(ctx, normalFont, parts.after);
    const total = wBefore + wEmph + wAfter;
    const w = total + 12;
    const h = fontSize + 6;
    ctx.fillStyle = pal.chipBg;
    ctx.fillRect(mx - w / 2, my - h / 2, w, h);
    const color = d.edge.color || pal.label;
    ctx.fillStyle = color;
    ctx.fillRect(mx - w / 2, my - h / 2, 2, h);
    const baseX = mx - total / 2;
    ctx.font = normalFont;
    ctx.fillText(parts.before, baseX, my);
    ctx.font = boldFont;
    ctx.fillText(parts.emphasis, baseX + wBefore, my);
    ctx.font = normalFont;
    ctx.fillText(parts.after, baseX + wBefore + wEmph, my);
  }
  ctx.restore();
}

interface Rect { x: number; y: number; w: number; h: number; }
const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function drawLabels(
  sc: Frame,
  placed: Placed[],
  pal: Palette,
  neighbors: Set<string>,
): void {
  const { ctx } = sc;
  const hovered = sc.hoveredNodeId;

  const priority = (p: Placed): number => {
    if (p.node.id === hovered) return 0;
    if (p.node.kind === 'person' && p.node.isCenter) return 1;
    if (neighbors.has(p.node.id)) return 2;
    if (sc.focusGroupId && !p.dimmed) return 2;
    if (p.node.kind === 'bubble') return 3;
    return 4;
  };

  const candidates = placed
    .filter((p) => p.appear > 0.7)
    .sort((a, b) => priority(a) - priority(b) || b.depth - a.depth);

  // Keep other names off the center node and its rings.
  const taken: Rect[] = [];
  for (const p of placed) {
    if (p.node.kind !== 'person' || !p.node.isCenter) continue;
    const r = p.radius * 1.4;
    taken.push({ x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 });
  }
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';

  for (const p of candidates) {
    const node = p.node;
    const isCenter = node.kind === 'person' && node.isCenter;
    const table = sc.isMobile ? FONT_SIZE.mobile : FONT_SIZE.desktop;
    const base = isCenter ? table.center : table.normal;
    const minScale = sc.isMobile ? LABEL_MIN_SCALE.mobile : LABEL_MIN_SCALE.desktop;
    const size = Math.round(base * clamp(sc.transform.k * p.scale, minScale, 1.35));
    const isHovered = node.id === hovered;
    const weight = isCenter || isHovered ? '600 ' : '500 ';
    const font = `${weight}${size}px ${GRAPH_FONT}`;
    const text = node.kind === 'bubble' ? node.label.split(' · ')[0] : node.label;
    const w = textWidth(ctx, font, text);
    // Below the node first; if that spot is taken, try above it.
    const gap = node.kind === 'bubble' ? 9 : 5;
    const below = p.y + p.radius + gap;
    const above = p.y - p.radius - gap - size;
    // Keep the text inside the canvas: near an edge it slides inward rather
    // than getting cut off.
    const edge = 6;
    const textX = clamp(p.x, edge + w / 2, Math.max(edge + w / 2, sc.width - edge - w / 2));
    const rectAt = (y: number): Rect => ({ x: textX - w / 2 - 3, y: y - 1, w: w + 6, h: size + 3 });
    const force = priority(p) === 0 || isCenter;
    let top = below;
    if (!force) {
      const free = (y: number) => !taken.some((r) => overlaps(r, rectAt(y)));
      if (free(below)) top = below;
      else if (free(above)) top = above;
      else continue;
    }
    taken.push(rectAt(top));

    const fade = p.dimmed ? 0.25 : 1;
    ctx.font = font;
    ctx.globalAlpha = Math.min(1, p.alpha * 1.15) * fade;
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = pal.labelHalo;
    ctx.strokeText(text, textX, top);
    ctx.fillStyle = isHovered ? pal.accent : pal.label;
    ctx.fillText(text, textX, top);
  }
  ctx.restore();
}

function drawFrame(sc: Frame, pal: Palette): void {
  const { ctx, width, height } = sc;
  const inset = 10;
  const arm = 16;
  ctx.save();
  ctx.strokeStyle = pal.frame;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [sx, sy] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
    const x = sx ? width - inset : inset;
    const y = sy ? height - inset : inset;
    const dx = sx ? -arm : arm;
    const dy = sy ? -arm : arm;
    ctx.moveTo(x + dx, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy);
  }
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Frame

export function paintScene(
  input: SceneContext,
  nodes: SimulationNode[],
  edges: SimulationEdge[],
): NodePlacement[] {
  const sc: Frame = { ...input, proj: makeProjector(input.camera) };
  const { ctx, width, height, camera } = sc;
  const pal = palette(sc.isDark);
  const k = sc.transform.k;

  ctx.save();
  ctx.clearRect(0, 0, width, height);

  // Extent of the graph around the pivot sizes the floor grid.
  let worldRadius = 0;
  for (const n of nodes) {
    if (n.x === undefined || n.y === undefined) continue;
    const d = Math.hypot(n.x - camera.pivotX, n.y - camera.pivotY);
    if (d > worldRadius) worldRadius = d;
  }

  const pivot = toScreen(sc, camera.pivotX, camera.pivotY, GROUND_Z);
  drawBackdrop(sc, pal, pivot);
  drawFloor(sc, pal, worldRadius);

  // Neighbors of the hovered node, both directions
  const hovered = sc.hoveredNodeId;
  const neighbors = new Set<string>();
  if (hovered) {
    for (const e of edges) {
      const s = endpointId(e.source);
      const t = endpointId(e.target);
      if (s === hovered) neighbors.add(t);
      else if (t === hovered) neighbors.add(s);
    }
  }
  const hoverActive = hovered !== null;
  const focusGroup = hoverActive ? null : (sc.focusGroupId ?? null);
  const inFocus = (node: SimulationNode): boolean => {
    if (!focusGroup) return true;
    return node.kind === 'bubble' ? node.groupId === focusGroup : node.groups.includes(focusGroup)
      || (node.kind === 'person' && node.isCenter);
  };
  const dimActive = hoverActive || focusGroup !== null;

  // Place nodes
  const placed: Placed[] = [];
  const byId = new Map<string, Placed>();
  let minDepth = Infinity;
  let maxDepth = -Infinity;
  for (const node of nodes) {
    if (node.x === undefined || node.y === undefined) continue;
    const appear = sc.appear(node.id);
    if (appear <= 0) continue;
    const eased = easeOutCubic(appear);
    const bob = sc.reducedMotion ? 0 : Math.sin(sc.time * 0.9 + hashUnit(node.id) * Math.PI * 2) * 4;
    const z = GROUND_Z + (sc.elevation(node.id) + bob - GROUND_Z) * eased;
    const s = toScreen(sc, node.x, node.y, z);
    const pop = appear < 1 ? Math.max(0, easeOutBack(appear)) : 1;
    const minRadius = sc.isMobile ? MIN_SCREEN_RADIUS.mobile : MIN_SCREEN_RADIUS.desktop;
    const radius = Math.max(baseRadius(node, sc.isMobile) * k * s.scale, minRadius) * pop;
    const ground = camera.lift > 0.05 ? toScreen(sc, node.x, node.y, GROUND_Z) : null;
    const dimmed = hoverActive
      ? node.id !== hovered && !neighbors.has(node.id)
      : !inFocus(node);
    const p: Placed = {
      node,
      x: s.x,
      y: s.y,
      radius,
      depth: s.depth,
      scale: s.scale,
      color: nodeColor(node, pal),
      alpha: Math.min(1, appear * 1.5),
      appear,
      ground,
      dimmed,
    };
    placed.push(p);
    byId.set(node.id, p);
    if (s.depth < minDepth) minDepth = s.depth;
    if (s.depth > maxDepth) maxDepth = s.depth;
  }

  // Depth fog: far nodes fade, near nodes stay crisp
  const depthSpan = maxDepth - minDepth;
  const fogFor = (depth: number): number =>
    depthSpan > 1 && camera.lift > 0.05
      ? 1 - 0.5 * camera.lift * (1 - (depth - minDepth) / depthSpan)
      : 1;
  for (const p of placed) {
    p.alpha *= fogFor(p.depth);
    if (p.dimmed) p.alpha *= 0.28;
  }

  // An edge lights up when it leaves the hovered node. Edges arriving at it
  // light up too, unless the data already has the same pair the other way.
  const outgoing = new Set<string>();
  if (hovered) {
    for (const e of edges) {
      if (endpointId(e.source) === hovered) outgoing.add(endpointId(e.target));
    }
  }
  const isHighlighted = (s: string, t: string): boolean =>
    hovered !== null && (s === hovered || (t === hovered && !outgoing.has(s)));

  // Edges
  const drawn: DrawnEdge[] = [];
  edges.forEach((edge, index) => {
    if (edge.type === 'membership') return;
    const from = byId.get(endpointId(edge.source));
    const to = byId.get(endpointId(edge.target));
    if (!from || !to) return;
    const progress = clamp((Math.min(from.appear, to.appear) - 0.3) / 0.7, 0, 1);
    if (progress <= 0) return;
    drawn.push({
      edge,
      from,
      to,
      progress,
      highlighted: isHighlighted(from.node.id, to.node.id),
      emphasized: focusGroup !== null && !from.dimmed && !to.dimmed,
      fog: fogFor((from.depth + to.depth) / 2),
      index,
    });
  });

  drawStems(sc, placed);
  drawEdges(sc, drawn, dimActive);
  drawPulses(sc, drawn, dimActive);

  // Nodes far to near, but anything dimmed goes behind everything lit, so
  // the hovered person and their connections are never hidden.
  placed.sort((a, b) => Number(b.dimmed) - Number(a.dimmed) || a.depth - b.depth);
  for (const p of placed) {
    if (p.node.kind === 'bubble') drawBubble(sc, p, pal);
    else drawSphere(sc, p, pal);
    if (p.node.kind === 'person' && p.node.isCenter) drawCenterDecorations(sc, p, pal);
  }

  const hoveredPlaced = hovered ? byId.get(hovered) : undefined;
  if (hoveredPlaced) drawReticle(sc, hoveredPlaced, pal);

  drawEdgeLabels(sc, drawn, pal);
  drawLabels(sc, placed, pal, neighbors);
  drawFrame(sc, pal);

  ctx.restore();

  return placed.map(({ node, x, y, radius, depth }) => ({ node, x, y, radius, depth }));
}

/**
 * Node under a screen point. If the point is on a drawn dot, the front-most
 * such dot wins (what you see is what you click); otherwise the nearest dot
 * within `slack` pixels, which makes small dots easy to hit on touch.
 */
export function pickNode(
  placements: NodePlacement[],
  x: number,
  y: number,
  slack: number,
): SimulationNode | undefined {
  let onTop: NodePlacement | undefined;
  let nearest: NodePlacement | undefined;
  let nearestGap = Infinity;
  for (const p of placements) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= p.radius) {
      if (!onTop || p.depth > onTop.depth) onTop = p;
      continue;
    }
    const gap = d - p.radius;
    if (gap <= slack && gap < nearestGap) {
      nearest = p;
      nearestGap = gap;
    }
  }
  return (onTop ?? nearest)?.node;
}
