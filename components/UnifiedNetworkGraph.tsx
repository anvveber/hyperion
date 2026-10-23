'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  forceSimulation, forceLink, forceManyBody, forceCenter,
  forceCollide, forceX, forceY, type Simulation,
} from 'd3-force';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomTransform, type ZoomBehavior } from 'd3-zoom';
import { drag } from 'd3-drag';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import PillSelector from './PillSelector';
import { GraphFilterGroupPill } from './GraphFilterPills';
import { paintScene, pickNode, type NodePlacement } from './graph/scene-renderer';
import { approach, nearestFullTurn, project, unprojectToPlane, type Camera } from './graph/camera';
import { computeElevations, hashUnit } from './graph/elevation';
import { getLODTier } from './graph/lod';
import { getCachedPhoto, loadPhoto } from './graph/photo-cache';
import { diffSimulationData } from './graph/diff-simulation';
import { resolveGraphMode } from './graph/mode-resolution';
import { buildSimulationNodes, type RawGraphPerson } from './graph/bubble-composition';
import { buildHubAndSpokeEdges } from './graph/edge-composition';
import { UNGROUPED_SYNTHETIC_ID } from './graph/simulation-types';
import type { SimulationNode, SimulationEdge } from './graph/simulation-types';

// Props interface - unchanged from pre-rewrite file
interface Group { id: string; name: string; color: string | null; }
type IncludeMode = 'or' | 'and';
type GroupFilterItem = { id: string; label: string; color: string | null; isNegative: boolean; };
type ViewMode = '3d' | 'flat';

const VIEW_STORAGE_KEY = 'hyperion:graphView';
const PITCH_3D = 0.9;
const PITCH_MIN = 0.15;
const PITCH_MAX = 1.25;
const IDLE_DRIFT_RAD_PER_S = 0.05;
const IDLE_DRIFT_DELAY_MS = 2500;
const APPEAR_SECONDS = 0.8;
const INTRO_HOP_DELAY = 0.18;
const nowSeconds = (): number => performance.now() / 1000;

/** Perspective distance that keeps depth effects similar for small and large graphs. */
function distanceFor(nodes: SimulationNode[], pivotX: number, pivotY: number): number {
  let radius = 0;
  for (const n of nodes) {
    if (n.x === undefined || n.y === undefined) continue;
    const d = Math.hypot(n.x - pivotX, n.y - pivotY);
    if (d > radius) radius = d;
  }
  return Math.max(900, radius * 2.6);
}

interface UnifiedNetworkGraphProps {
  apiEndpoint?: string;
  groups?: Group[];
  centerNodeNonClickable?: boolean;
  linkDistance?: number;
  chargeStrength?: number;
  refreshKey?: number;
  graphMode?: 'individuals' | 'bubbles' | null;
  compact?: boolean;
}

export default function UnifiedNetworkGraph({
  apiEndpoint,
  groups,
  centerNodeNonClickable = false,
  linkDistance = 160,
  chargeStrength = -400,
  refreshKey,
  graphMode: graphModeProp = null,
  compact = false,
}: UnifiedNetworkGraphProps) {
  const t = useTranslations('dashboard.graph');
  const tPeople = useTranslations('people');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const router = useRouter();

  // Simulation state
  const simRef = useRef<Simulation<SimulationNode, SimulationEdge> | null>(null);
  const nodesRef = useRef<SimulationNode[]>([]);
  const edgesRef = useRef<SimulationEdge[]>([]);
  const placementsRef = useRef<NodePlacement[]>([]);
  const cameraRef = useRef<Camera>({
    yaw: -0.9, pitch: 0, lift: 0, distance: 1200, pivotX: 0, pivotY: 0,
  });
  const cameraTargetRef = useRef<{ yaw: number; pitch: number; lift: number }>({
    yaw: 0, pitch: PITCH_3D, lift: 1,
  });
  const elevationRef = useRef<Map<string, number>>(new Map());
  const bornAtRef = useRef<Map<string, number>>(new Map());
  const introStartedRef = useRef<boolean>(false);
  const introEndRef = useRef<number>(0);
  const reducedMotionRef = useRef<boolean>(false);
  const visibleRef = useRef<boolean>(true);
  const pointerInsideRef = useRef<boolean>(false);
  const lastInteractionRef = useRef<number>(0);
  const orbitRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const viewModeRef = useRef<ViewMode>('3d');
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const zoomBehaviorRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const hoveredNodeIdRef = useRef<string | null>(null);
  const touchSelectedNodeIdRef = useRef<string | null>(null);
  const dirtyRef = useRef<boolean>(false);
  const rafRef = useRef<number | null>(null);
  const unpinTimeoutRef = useRef<number | null>(null);
  const isDraggingRef = useRef<boolean>(false);

  // Filter state
  const [selectedGroupFilters, setSelectedGroupFilters] = useState<GroupFilterItem[]>([]);
  const [includeMode, setIncludeMode] = useState<IncludeMode>('or');
  const [isMobile, setIsMobile] = useState(false);
  const capitalizeType = useLocale().startsWith('de');

  // Bubble state
  const [expandedBubbles, setExpandedBubbles] = useState<Set<string>>(new Set());
  const [localGraphMode, setLocalGraphMode] = useState<'individuals' | 'bubbles' | null>(graphModeProp);
  const rawCacheRef = useRef<{ nodes: RawGraphPerson[]; edges: SimulationEdge[] } | null>(null);

  // Ungrouped label for bubble composition
  const ungroupedLabel = t('unsortedBubbleLabel');

  const includeGroupIds = useMemo(
    () => selectedGroupFilters.filter((f) => !f.isNegative).map((f) => f.id),
    [selectedGroupFilters],
  );
  const excludeGroupIds = useMemo(
    () => selectedGroupFilters.filter((f) => f.isNegative).map((f) => f.id),
    [selectedGroupFilters],
  );

  // Detect mobile screen size
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Recenter simulation when canvas resizes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const observer = new ResizeObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const sim = simRef.current;
        if (!sim || isDraggingRef.current) return;

        const rect = canvas.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        cameraRef.current.pivotX = w / 2;
        cameraRef.current.pivotY = h / 2;

        type CenterForce = ReturnType<typeof forceCenter<SimulationNode>>;
        type XForce = ReturnType<typeof forceX<SimulationNode>>;
        type YForce = ReturnType<typeof forceY<SimulationNode>>;

        const center = sim.force('center') as CenterForce | undefined;
        if (center) center.x(w / 2).y(h / 2);

        const fx = sim.force('centerX') as XForce | undefined;
        if (fx) fx.x(w / 2);

        const fy = sim.force('centerY') as YForce | undefined;
        if (fy) fy.y(h / 2);

        sim.alpha(0.3).restart();
      }, 150);
    });

    observer.observe(canvas);
    return () => {
      observer.disconnect();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, []);

  // Zoom and pan so the whole network fits, as seen from the camera's
  // target angle. Small graphs get only a slight zoom-in, never a huge one.
  const fitView = useCallback((animate: boolean) => {
    const canvas = canvasRef.current;
    const zoomBehavior = zoomBehaviorRef.current;
    if (!canvas || !zoomBehavior) return;
    const rect = canvas.getBoundingClientRect();
    const cam = cameraRef.current;
    const target = cameraTargetRef.current;
    const view: Camera = {
      ...cam,
      yaw: target.yaw,
      pitch: target.pitch,
      lift: target.lift,
      distance: distanceFor(nodesRef.current, cam.pivotX, cam.pivotY),
    };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodesRef.current) {
      if (n.x === undefined || n.y === undefined) continue;
      const p = project(view, n.x, n.y, elevationRef.current.get(n.id) ?? 0);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    let next = zoomIdentity;
    if (Number.isFinite(minX)) {
      const pad = isMobile ? 32 : 56;
      const k = Math.min(
        1.25,
        Math.max(0.15, Math.min(
          (rect.width - pad * 2) / Math.max(maxX - minX, 1),
          (rect.height - pad * 2) / Math.max(maxY - minY, 1),
        )),
      );
      // Labels hang below nodes, so nudge the frame up a little.
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2 + 8;
      next = zoomIdentity.translate(rect.width / 2 - k * cx, rect.height / 2 - k * cy).scale(k);
    }
    if (animate) {
      select(canvas).transition().duration(750).call(zoomBehavior.transform, next);
    } else {
      select(canvas).call(zoomBehavior.transform, next);
    }
  }, [isMobile]);

  // Re-center the graph view
  const recenterGraph = useCallback(() => {
    const target = cameraTargetRef.current;
    target.yaw = nearestFullTurn(cameraRef.current.yaw);
    target.pitch = viewModeRef.current === '3d' ? PITCH_3D : 0;
    lastInteractionRef.current = performance.now();
    fitView(true);
  }, [fitView]);

  const toggleFilterSign = (id: string) => {
    setSelectedGroupFilters((prev) =>
      prev.map((filter) =>
        filter.id === id
          ? { ...filter, isNegative: !filter.isNegative }
          : filter,
      ),
    );
  };

  const requestPaint = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  const formatEdgeLabel = useCallback((edge: SimulationEdge) => {
    if (edge.type === 'aggregated' || edge.type === 'membership') {
      return { before: '', emphasis: '', after: '' };
    }
    const youLabel = tPeople('you');
    const sourceName = edge.sourceLabel ?? '';
    const targetName = edge.targetLabel ?? '';
    const typeStr = capitalizeType
      ? edge.type.charAt(0).toUpperCase() + edge.type.slice(1)
      : edge.type.toLowerCase();
    let full: string;
    if (sourceName === youLabel || sourceName === 'You') {
      full = tPeople('graphEdgeLabelFromYou', { type: typeStr });
    } else if (targetName === youLabel || targetName === 'You') {
      full = tPeople('graphEdgeLabelToYou', { type: typeStr });
    } else {
      full = tPeople('graphEdgeLabel', { type: typeStr });
    }
    const idx = full.toLowerCase().indexOf(typeStr.toLowerCase());
    if (idx < 0) return { before: full, emphasis: '', after: '' };
    return {
      before: full.substring(0, idx),
      emphasis: full.substring(idx, idx + typeStr.length),
      after: full.substring(idx + typeStr.length),
    };
  }, [tPeople, capitalizeType]);

  const appearOf = useCallback((id: string): number => {
    if (reducedMotionRef.current) return 1;
    const born = bornAtRef.current.get(id);
    if (born === undefined) return 1;
    return Math.min(1, Math.max(0, (nowSeconds() - born) / APPEAR_SECONDS));
  }, []);

  const elevationOf = useCallback((id: string): number => elevationRef.current.get(id) ?? 0, []);

  const setView = useCallback((mode: ViewMode) => {
    viewModeRef.current = mode;
    setViewMode(mode);
    const cam = cameraRef.current;
    const target = cameraTargetRef.current;
    if (mode === '3d') {
      target.pitch = PITCH_3D;
      target.lift = 1;
    } else {
      target.pitch = 0;
      target.lift = 0;
      target.yaw = nearestFullTurn(cam.yaw);
    }
    lastInteractionRef.current = performance.now();
    fitView(true);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, mode);
    } catch {
      // Storage can be unavailable (private mode); the choice just won't persist.
    }
  }, [fitView]);

  // Restore the saved view mode and follow the reduced-motion preference.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_STORAGE_KEY);
      if (saved === 'flat' || saved === '3d') {
        viewModeRef.current = saved;
        setViewMode(saved);
        const target = cameraTargetRef.current;
        target.pitch = saved === '3d' ? PITCH_3D : 0;
        target.lift = saved === '3d' ? 1 : 0;
      }
    } catch {
      // Ignore storage errors and keep the default.
    }

    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      reducedMotionRef.current = media.matches;
      dirtyRef.current = true;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  // Stop drawing while the graph is scrolled out of view.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      visibleRef.current = entries.some((e) => e.isIntersecting);
      if (visibleRef.current) dirtyRef.current = true;
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // Step 1: Paint
  const runPaint = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Keep backing store in sync with CSS size and DPR.
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const wantW = Math.floor(rect.width * dpr);
    const wantH = Math.floor(rect.height * dpr);
    if (canvas.width !== wantW || canvas.height !== wantH) {
      canvas.width = wantW;
      canvas.height = wantH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const transform = transformRef.current;
    const lod = getLODTier(transform.k);
    const isDark = document.documentElement.classList.contains('dark');

    // Request photos for nodes that were on screen last frame.
    if (lod !== 'dots') {
      const padPx = 64;
      for (const p of placementsRef.current) {
        const node = p.node;
        if (node.kind !== 'person' || !node.photo) continue;
        if (p.x < -padPx || p.x > rect.width + padPx || p.y < -padPx || p.y > rect.height + padPx) continue;
        const src = node.id.startsWith('user-') ? '/api/photos/user' : `/api/photos/${node.id}`;
        loadPhoto(node.id, src, requestPaint);
      }
    }

    placementsRef.current = paintScene(
      {
        ctx,
        transform,
        camera: cameraRef.current,
        width: rect.width,
        height: rect.height,
        lod,
        isDark,
        isMobile,
        time,
        reducedMotion: reducedMotionRef.current,
        hoveredNodeId: touchSelectedNodeIdRef.current ?? hoveredNodeIdRef.current,
        elevation: elevationOf,
        appear: appearOf,
        getPhoto: getCachedPhoto,
        formatEdgeLabel,
      },
      nodesRef.current,
      edgesRef.current,
    );
  }, [isMobile, requestPaint, formatEdgeLabel, elevationOf, appearOf]);

  // Animation loop: moves the camera toward its target, drifts slowly when
  // idle, and repaints. Ambient effects run at 30 fps; interaction at full rate.
  useEffect(() => {
    let last = performance.now();
    let lastPaint = 0;
    const tick = (nowMs: number) => {
      rafRef.current = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (nowMs - last) / 1000);
      last = nowMs;
      if (!visibleRef.current) return;

      const cam = cameraRef.current;
      const target = cameraTargetRef.current;
      const reduced = reducedMotionRef.current;
      const time = nowMs / 1000;
      const introActive = time < introEndRef.current;

      if (
        viewModeRef.current === '3d' && !reduced && introStartedRef.current
        && !pointerInsideRef.current && !orbitRef.current && !isDraggingRef.current
        && nowMs - lastInteractionRef.current > IDLE_DRIFT_DELAY_MS
      ) {
        target.yaw += dt * IDLE_DRIFT_RAD_PER_S;
      }

      // Perspective strength follows the size of the graph.
      const wantDistance = distanceFor(nodesRef.current, cam.pivotX, cam.pivotY);

      let moving = false;
      if (introStartedRef.current) {
        const rate = introActive ? 1.5 : 4;
        if (reduced) {
          cam.yaw = target.yaw;
          cam.pitch = target.pitch;
          cam.lift = target.lift;
          cam.distance = wantDistance;
        } else {
          const before = cam.yaw + cam.pitch + cam.lift;
          cam.yaw = approach(cam.yaw, target.yaw, dt, rate);
          cam.pitch = approach(cam.pitch, target.pitch, dt, rate);
          cam.lift = approach(cam.lift, target.lift, dt, rate);
          cam.distance = approach(cam.distance, wantDistance, dt, 2);
          moving = Math.abs(cam.yaw + cam.pitch + cam.lift - before) > 1e-5;
        }
      }

      const interacting = hoveredNodeIdRef.current !== null || isDraggingRef.current || orbitRef.current !== null;
      if (!reduced) {
        const minGap = moving || introActive || interacting || dirtyRef.current ? 0 : 1000 / 30;
        if (nowMs - lastPaint < minGap) return;
      } else if (!moving && !dirtyRef.current) {
        return;
      }
      dirtyRef.current = false;
      lastPaint = nowMs;
      runPaint(time);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [runPaint]);

  // Step 2: Simulation builder
  const buildSimulation = useCallback((nodes: SimulationNode[], edges: SimulationEdge[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    cameraRef.current.pivotX = width / 2;
    cameraRef.current.pivotY = height / 2;
    const mobileLinkDistance = isMobile ? 110 : linkDistance;
    const mobileChargeStrength = isMobile ? -250 : chargeStrength;
    const personCollisionR = isMobile ? 38 : 52;

    // Visible-radius-aware collision so bubbles don't overlap "you" or each other.
    const collisionForNode = (d: SimulationNode): number => {
      if (d.kind === 'bubble') return (isMobile ? 12 : 14) + (isMobile ? 18 : 28);
      return personCollisionR;
    };

    const membershipLinkDistance = isMobile ? 22 : 32;
    const aggregatedLinkDistance = isMobile ? 150 : 220;

    // Custom force: each expanded ghost behaves like an "invisible big bubble".
    // Members get strongly pulled toward the ghost (orbiting close to it);
    // non-members get pushed out of the ghost's domain so the cluster reads
    // as a coherent island.
    const expandedClusterField = (() => {
      const tightenStrength = 0.35;
      const repelStrength = 0.5;
      const padding = isMobile ? 18 : 24;
      const memberRadius = isMobile ? 12 : 14;
      let attached: SimulationNode[] = [];
      const memberToGhostId = new Map<string, string>();

      const force = (alpha: number) => {
        // Build per-ghost domain (ghost position + radius + member set + protected ids)
        type Domain = { ghostId: string; x: number; y: number; r: number; protectedIds: Set<string> };
        const domains: Domain[] = [];
        for (const n of attached) {
          if (n.kind !== 'bubble' || !n.isExpanded || n.x === undefined) continue;
          const r = Math.sqrt(Math.max(n.memberCount, 1)) * memberRadius * 1.2 + padding;
          const protectedIds = new Set<string>([n.id, ...n.memberIds]);
          domains.push({ ghostId: n.id, x: n.x, y: n.y ?? 0, r, protectedIds });
        }
        if (domains.length === 0) return;

        // Tighten each expanded member toward its ghost
        for (const node of attached) {
          if (node.kind !== 'person') continue;
          const ghostId = memberToGhostId.get(node.id);
          if (!ghostId) continue;
          const dom = domains.find((d) => d.ghostId === ghostId);
          if (!dom || node.x === undefined) continue;
          const dx = dom.x - (node.x ?? 0);
          const dy = dom.y - (node.y ?? 0);
          node.vx = (node.vx ?? 0) + dx * tightenStrength * alpha;
          node.vy = (node.vy ?? 0) + dy * tightenStrength * alpha;
        }

        // Push non-members out of each domain
        for (const dom of domains) {
          for (const node of attached) {
            if (dom.protectedIds.has(node.id)) continue;
            if (node.x === undefined) continue;
            const dx = (node.x ?? 0) - dom.x;
            const dy = (node.y ?? 0) - dom.y;
            const d = Math.hypot(dx, dy);
            if (d > 0 && d < dom.r) {
              const push = ((dom.r - d) / dom.r) * repelStrength * alpha;
              node.vx = (node.vx ?? 0) + (dx / d) * push * dom.r;
              node.vy = (node.vy ?? 0) + (dy / d) * push * dom.r;
            }
          }
        }
      };

      force.initialize = (n: SimulationNode[]) => {
        attached = n;
        memberToGhostId.clear();
        for (const node of n) {
          if (node.kind === 'bubble' && node.isExpanded) {
            for (const memberId of node.memberIds) {
              memberToGhostId.set(memberId, node.id);
            }
          }
        }
      };

      return force;
    })();

    const sim = forceSimulation<SimulationNode>(nodes)
      .velocityDecay(0.6)
      .force('link', forceLink<SimulationNode, SimulationEdge>(edges)
        .id((d) => d.id)
        .distance((e) => {
          if (e.type === 'membership') return membershipLinkDistance;
          if (e.type === 'aggregated') return aggregatedLinkDistance;
          return mobileLinkDistance;
        })
        .strength((e) => e.type === 'membership' ? 0.4 : 1))
      .force('charge', forceManyBody().strength(mobileChargeStrength))
      .force('center', forceCenter(width / 2, height / 2))
      // Stronger pull for "you" anchors it at canvas-center under normal forces,
      // while still letting the user drag it around for fun.
      .force('centerX', forceX<SimulationNode>(width / 2).strength((d) => {
        if (d.kind === 'person' && d.isCenter) return 0.5;
        if (d.kind === 'bubble' && d.isExpanded) return 0;
        return 0.15;
      }))
      .force('centerY', forceY<SimulationNode>(height / 2).strength((d) => {
        if (d.kind === 'person' && d.isCenter) return 0.5;
        if (d.kind === 'bubble' && d.isExpanded) return 0;
        return 0.15;
      }))
      .force('collision', forceCollide<SimulationNode>().radius(collisionForNode))
      .force('expandedCluster', expandedClusterField);

    sim.on('tick', () => {
      requestPaint();
    });

    return sim;
  }, [isMobile, linkDistance, chargeStrength, requestPaint]);

  // Step 3: Composition helper - recomposes sim data from raw cache
  const recomposeAndBuildSim = useCallback((raw: { nodes: RawGraphPerson[]; edges: SimulationEdge[] }) => {
    const incomingPeople = raw.nodes;

    // If no groups prop, we're not on the dashboard - skip bubble logic.
    const resolvedMode = groups ? resolveGraphMode(localGraphMode) : 'individuals';

    // Always expand any group that's currently in the include filter.
    const nextExpanded = new Set(expandedBubbles);
    if (resolvedMode === 'bubbles' && groups) {
      for (const id of includeGroupIds) {
        nextExpanded.add(id);
      }
    }

    // Drop expanded groups that no longer exist in the current data.
    if (resolvedMode === 'bubbles' && groups) {
      const presentGroups = new Set(groups.map((g) => g.id));
      presentGroups.add(UNGROUPED_SYNTHETIC_ID);
      for (const id of [...nextExpanded]) {
        if (!presentGroups.has(id)) nextExpanded.delete(id);
      }
    }
    if (nextExpanded.size !== expandedBubbles.size) {
      setExpandedBubbles(nextExpanded);
    }

    const incomingNodes = buildSimulationNodes({
      people: incomingPeople,
      groups: groups ?? [],
      mode: resolvedMode,
      expandedBubbles: nextExpanded,
      ungroupedLabel,
    });

    const rawEdges: SimulationEdge[] = raw.edges;
    const composedEdges = resolvedMode === 'bubbles'
      ? buildHubAndSpokeEdges({
          rawEdges,
          simNodes: incomingNodes,
          neutralEdgeColor: '#9ca3af',
        })
      : rawEdges;

    // d3-force's forceLink mutates each edge's source/target from string ids
    // to node-object references on the first sim build. If we reused those
    // mutated edges on a later rebuild, forceLink would keep the stale refs
    // (it skips resolution when source/target is already an object) - so the
    // new simulation would move new node objects while edges still drew
    // between the previous sim's node objects, leaving the visible
    // disconnect from #240. Clone edges with string ids each time.
    const incomingEdges: SimulationEdge[] = composedEdges.map((e) => ({
      ...e,
      source: typeof e.source === 'string' ? e.source : e.source.id,
      target: typeof e.target === 'string' ? e.target : e.target.id,
    }));

    const { nodes, edges } = diffSimulationData(nodesRef.current, incomingNodes, edgesRef.current, incomingEdges);
    nodesRef.current = nodes;
    edgesRef.current = edges;

    // Heights for the 3D view, and entrance times for nodes we haven't shown yet.
    // The first load staggers by hop count so the network unfolds from the center.
    const { elevation, hops } = computeElevations(nodes, edges);
    elevationRef.current = elevation;
    const now = nowSeconds();
    const born = bornAtRef.current;
    const firstLoad = !introStartedRef.current;
    let latest = now;
    for (const n of nodes) {
      if (born.has(n.id)) continue;
      const delay = firstLoad
        ? 0.15 + Math.min(hops.get(n.id) ?? 3, 4) * INTRO_HOP_DELAY + hashUnit(n.id) * 0.3
        : hashUnit(n.id) * 0.2;
      born.set(n.id, now + delay);
      latest = Math.max(latest, now + delay);
    }
    if (firstLoad) {
      introStartedRef.current = true;
      introEndRef.current = latest + APPEAR_SECONDS + 0.6;
    }

    simRef.current?.stop();
    if (firstLoad) {
      // Start from a spiral around the center instead of a single point, so
      // the pre-settled layout below is clean.
      const rect = canvasRef.current?.getBoundingClientRect();
      const pivotX = (rect?.width ?? 0) / 2;
      const pivotY = (rect?.height ?? 0) / 2;
      cameraRef.current.pivotX = pivotX;
      cameraRef.current.pivotY = pivotY;
      nodes.forEach((n, i) => {
        if (n.x !== 0 || n.y !== 0) return;
        const r = 30 * Math.sqrt(i + 0.5);
        const a = i * Math.PI * (3 - Math.sqrt(5));
        n.x = pivotX + r * Math.cos(a);
        n.y = pivotY + r * Math.sin(a);
      });
    }
    const sim = buildSimulation(nodes, edges);
    if (sim) {
      if (firstLoad) {
        // Settle the layout before the first frame: the entrance animation
        // then reveals a stable network instead of nodes flying into place.
        // Big graphs get fewer ticks up front (to keep the first paint quick)
        // and finish settling live, which the entrance animation hides.
        sim.stop();
        sim.tick(Math.round(Math.min(300, Math.max(100, 50000 / Math.max(nodes.length, 1)))));
        sim.restart();
        simRef.current = sim;
        // Start with the right perspective strength instead of easing into it.
        cameraRef.current.distance = distanceFor(nodes, cameraRef.current.pivotX, cameraRef.current.pivotY);
        fitView(false);
      } else {
        sim.alpha(0.3).restart();
        simRef.current = sim;
      }
    }
  }, [
    groups, localGraphMode, expandedBubbles,
    includeGroupIds, ungroupedLabel, buildSimulation, fitView,
  ]);

  // Step 4: Data-fetch effect
  useEffect(() => {
    if (!canvasRef.current || !apiEndpoint) return;

    let cancelled = false;

    const fetchData = async () => {
      const url = new URL(apiEndpoint, window.location.origin);
      url.searchParams.set('groupMatchOperator', includeMode);
      if (includeGroupIds.length > 0) url.searchParams.set('includeGroupIds', includeGroupIds.join(','));
      if (excludeGroupIds.length > 0) url.searchParams.set('excludeGroupIds', excludeGroupIds.join(','));

      const response = await fetch(url.toString());
      const data = await response.json() as { nodes: RawGraphPerson[]; edges: SimulationEdge[] };

      if (cancelled) return;

      rawCacheRef.current = data;
      recomposeAndBuildSim(data);
    };

    fetchData();
    return () => { cancelled = true; };
    // recomposeAndBuildSim intentionally excluded: it depends on bubble state
    // (expandedBubbles, localGraphMode) which are handled by the Step 5 effect
    // from the cached raw data - no need to re-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiEndpoint, refreshKey, includeMode, includeGroupIds, excludeGroupIds]);

  // Step 5: Recompose when bubble state changes (mode toggle, expand/collapse)
  useEffect(() => {
    const raw = rawCacheRef.current;
    if (!raw) return;
    recomposeAndBuildSim(raw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localGraphMode, expandedBubbles]);

  // Step 6: Zoom, click, hover, and drag handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const clientCoordsOf = (e: Event): [number, number] => {
      if ('touches' in e) {
        const te = e as TouchEvent;
        const t = te.touches[0] ?? te.changedTouches[0];
        return [t.clientX, t.clientY];
      }
      const me = e as MouseEvent;
      return [me.clientX, me.clientY];
    };

    // Screen point to simulation coordinates on the plane at height z.
    const toGraphCoords = (clientX: number, clientY: number, z: number): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      const t = transformRef.current;
      const px = (clientX - rect.left - t.x) / t.k;
      const py = (clientY - rect.top - t.y) / t.k;
      const hit = unprojectToPlane(cameraRef.current, px, py, z);
      return hit ? [hit.x, hit.y] : [px, py];
    };

    const nodeAt = (clientX: number, clientY: number): SimulationNode | undefined => {
      const rect = canvas.getBoundingClientRect();
      return pickNode(placementsRef.current, clientX - rect.left, clientY - rect.top, isMobile ? 12 : 6);
    };

    const markInteraction = () => {
      lastInteractionRef.current = performance.now();
    };

    const zoomBehavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 3])
      .filter((event: Event) => {
        const me = event as MouseEvent;
        if (me.ctrlKey || me.button || me.shiftKey) return false;
        if (event.type === 'mousedown' || event.type === 'touchstart') {
          const touch = 'touches' in event ? (event as TouchEvent).touches[0] : null;
          const cx = touch ? touch.clientX : me.clientX;
          const cy = touch ? touch.clientY : me.clientY;
          if (nodeAt(cx, cy)) return false;
        }
        return true;
      })
      .on('zoom', (event) => {
        transformRef.current = event.transform;
        markInteraction();
        requestPaint();
      });
    zoomBehaviorRef.current = zoomBehavior;
    select(canvas).call(zoomBehavior);

    const onMove = (event: MouseEvent) => {
      if (orbitRef.current) return;
      const node = nodeAt(event.clientX, event.clientY);
      const id = node?.id ?? null;
      if (hoveredNodeIdRef.current !== id) {
        hoveredNodeIdRef.current = id;
        canvas.style.cursor = id ? 'pointer' : 'default';
        requestPaint();
      }
    };

    const handleNodeActivate = (node: SimulationNode) => {
      if (node.kind === 'bubble') {
        // Collapse is instant.
        if (node.isExpanded) {
          setExpandedBubbles((prev) => {
            const next = new Set(prev);
            next.delete(node.groupId);
            return next;
          });
          return;
        }
        // Expand: push the bubble outward, pin it, reheat the sim so other
        // nodes redistribute, wait briefly, THEN trigger expansion so the
        // cluster lands in cleared space.
        if (node.x !== undefined && node.y !== undefined) {
          const center = nodesRef.current.find(
            (n): n is SimulationNode & { x: number; y: number } =>
              n.kind === 'person' && n.isCenter && n.x !== undefined && n.y !== undefined,
          );
          if (center) {
            const dx = node.x - center.x;
            const dy = node.y - center.y;
            const dist = Math.hypot(dx, dy) || 1;
            const memberRadius = isMobile ? 12 : 14;
            const padding = isMobile ? 18 : 24;
            const clusterRadius = Math.sqrt(Math.max(node.memberCount, 1)) * memberRadius * 1.2 + padding;
            const targetDist = (clusterRadius + (isMobile ? 130 : 180)) * 2;
            const finalDist = Math.max(dist, targetDist);
            const ratio = finalDist / dist;
            const targetX = center.x + dx * ratio;
            const targetY = center.y + dy * ratio;

            node.x = targetX;
            node.y = targetY;
            node.fx = targetX;
            node.fy = targetY;
            node.vx = 0;
            node.vy = 0;
            if (simRef.current) simRef.current.alpha(0.3).restart();

            const bubbleId = node.id;
            const groupId = node.groupId;

            setExpandedBubbles((prev) => {
              const next = new Set(prev);
              next.add(groupId);
              return next;
            });
            // Release the pin once the cluster has had time to settle. With
            // centerX/Y strength = 0 for expanded ghosts, it stays put.
            if (unpinTimeoutRef.current !== null) window.clearTimeout(unpinTimeoutRef.current);
            unpinTimeoutRef.current = window.setTimeout(() => {
              unpinTimeoutRef.current = null;
              const ghost = nodesRef.current.find((n) => n.id === bubbleId);
              if (ghost) {
                ghost.fx = null;
                ghost.fy = null;
              }
            }, 1500);
          }
        }
        return;
      }
      if (centerNodeNonClickable && node.isCenter) return;
      if (node.id.startsWith('user-')) router.push('/dashboard');
      else router.push(`/people/${node.id}`);
    };

    let dragStartX = 0;
    let dragStartY = 0;
    let dragZ = 0;
    const CLICK_TRAVEL_PX = 4;
    const TOUCH_TRAVEL_PX = 12;

    const drag_ = drag<HTMLCanvasElement, unknown>()
      .container(canvas)
      .filter((event: MouseEvent) => !event.ctrlKey && !event.button && !event.shiftKey)
      .subject((event) => {
        const [cx, cy] = clientCoordsOf(event.sourceEvent);
        const node = nodeAt(cx, cy);
        return node ?? null;
      })
      .on('start', (event) => {
        const d = event.subject as SimulationNode | null;
        if (!d) return;
        dragStartX = event.x;
        dragStartY = event.y;
        dragZ = elevationOf(d.id);
        isDraggingRef.current = true;
        markInteraction();
        if (!event.active && simRef.current) simRef.current.alphaTarget(0.1).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event) => {
        const d = event.subject as SimulationNode | null;
        if (!d) return;
        const [cx, cy] = clientCoordsOf(event.sourceEvent);
        const [gx, gy] = toGraphCoords(cx, cy, dragZ);
        d.fx = gx;
        d.fy = gy;
      })
      .on('end', (event) => {
        const d = event.subject as SimulationNode | null;
        if (!d) return;
        isDraggingRef.current = false;
        if (!event.active && simRef.current) simRef.current.alphaTarget(0);
        d.fx = null;
        d.fy = null;
        const isTouch = event.sourceEvent?.type?.startsWith('touch');
        const threshold = isTouch ? TOUCH_TRAVEL_PX : CLICK_TRAVEL_PX;
        const traveled = Math.hypot(event.x - dragStartX, event.y - dragStartY);
        if (traveled >= threshold) return;

        if (isTouch) {
          if (touchSelectedNodeIdRef.current === d.id) {
            touchSelectedNodeIdRef.current = null;
            requestPaint();
            handleNodeActivate(d);
          } else {
            touchSelectedNodeIdRef.current = d.id;
            requestPaint();
          }
        } else {
          handleNodeActivate(d);
        }
      });

    select(canvas).call(drag_);

    const onTapEmpty = (event: TouchEvent) => {
      if (!touchSelectedNodeIdRef.current) return;
      const touch = event.changedTouches[0];
      if (touch && !nodeAt(touch.clientX, touch.clientY)) {
        touchSelectedNodeIdRef.current = null;
        requestPaint();
      }
    };

    // Orbit the 3D view: Shift + drag, or drag with the right mouse button.
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') markInteraction();
      if (viewModeRef.current !== '3d') return;
      if (!(event.shiftKey || event.button === 2)) return;
      orbitRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
      event.preventDefault();
    };
    const onPointerMove = (event: PointerEvent) => {
      const orbit = orbitRef.current;
      if (!orbit || orbit.pointerId !== event.pointerId) return;
      const dx = event.clientX - orbit.x;
      const dy = event.clientY - orbit.y;
      orbit.x = event.clientX;
      orbit.y = event.clientY;
      const cam = cameraRef.current;
      const target = cameraTargetRef.current;
      target.yaw += dx * 0.006;
      target.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, target.pitch - dy * 0.005));
      cam.yaw = target.yaw;
      cam.pitch = target.pitch;
      markInteraction();
      requestPaint();
    };
    const endOrbit = (event: PointerEvent) => {
      const orbit = orbitRef.current;
      if (!orbit || orbit.pointerId !== event.pointerId) return;
      orbitRef.current = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      canvas.style.cursor = 'default';
      markInteraction();
    };
    const onContextMenu = (event: MouseEvent) => {
      if (viewModeRef.current === '3d') event.preventDefault();
    };
    const onPointerEnter = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') pointerInsideRef.current = true;
    };
    const onPointerLeave = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      pointerInsideRef.current = false;
      markInteraction();
      if (hoveredNodeIdRef.current !== null) {
        hoveredNodeIdRef.current = null;
        requestPaint();
      }
    };

    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('touchend', onTapEmpty);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endOrbit);
    canvas.addEventListener('pointercancel', endOrbit);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('pointerenter', onPointerEnter);
    canvas.addEventListener('pointerleave', onPointerLeave);

    return () => {
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('touchend', onTapEmpty);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endOrbit);
      canvas.removeEventListener('pointercancel', endOrbit);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('pointerenter', onPointerEnter);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      select(canvas).on('.zoom', null);
      select(canvas).on('.drag', null);
      if (unpinTimeoutRef.current !== null) {
        window.clearTimeout(unpinTimeoutRef.current);
        unpinTimeoutRef.current = null;
      }
    };
  }, [centerNodeNonClickable, isMobile, requestPaint, router, elevationOf]);

  return (
    <div className="w-full h-full">
      {groups && (
        <div className="mb-4 space-y-2">
          <div className="flex items-stretch gap-3">
            <div className="shrink-0">
              <label className="flex h-full items-center text-sm placeholder-muted">
                <span
                  className="inline-flex h-full items-stretch rounded-md border border-border bg-surface-elevated p-0.5 focus-within:border-secondary focus-within:ring-2 focus-within:ring-secondary/20"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setIncludeMode((prev) => (prev === 'or' ? 'and' : 'or'))
                    }
                    className="inline-flex h-full px-3 items-center justify-center whitespace-nowrap text-base font-normal rounded border border-transparent text-foreground transition-all hover:bg-surface focus:outline-none"
                    aria-label={t('matchMode.ariaLabel', {
                      title:
                        includeMode === 'or'
                          ? t('matchMode.anyTitle')
                          : t('matchMode.allTitle'),
                    })}
                    title={
                      includeMode === 'or'
                        ? t('matchMode.anyTitle')
                        : t('matchMode.allTitle')
                    }
                  >
                    {includeMode === 'or'
                      ? t('matchMode.any')
                      : t('matchMode.all')}
                  </button>
                </span>
              </label>
            </div>

            <div className="flex-1">
              <PillSelector<GroupFilterItem>
                selectedItems={selectedGroupFilters}
                availableItems={groups.map((g) => ({
                  id: g.id,
                  label: g.name,
                  color: g.color,
                  isNegative: false,
                }))}
                onAdd={(item) => {
                  setSelectedGroupFilters((prev) =>
                    prev.some((f) => f.id === item.id)
                      ? prev
                      : [...prev, { ...item, isNegative: false }],
                  );
                }}
                onRemove={(itemId) =>
                  setSelectedGroupFilters((prev) =>
                    prev.filter((f) => f.id !== itemId),
                  )
                }
                onClearAll={() => setSelectedGroupFilters([])}
                placeholder={t('filterPlaceholder')}
                emptyMessage={t('noGroupsFound')}
                showAllOnFocus={true}
                renderPill={(item, onRemove) => (
                  <GraphFilterGroupPill
                    key={item.id}
                    id={item.id}
                    label={item.label}
                    color={item.color}
                    isNegative={item.isNegative}
                    onToggle={() => toggleFilterSign(item.id)}
                    onRemove={onRemove}
                    title={
                      item.isNegative
                        ? t('filterState.excluded')
                        : t('filterState.included')
                    }
                    ariaLabel={
                      item.isNegative
                        ? t('filterState.excludedWithLabel', {
                            label: item.label,
                          })
                        : t('filterState.includedWithLabel', {
                            label: item.label,
                          })
                    }
                  />
                )}
              />
            </div>
          </div>
        </div>
      )}
      <div className="relative">
        <canvas
          ref={canvasRef}
          className={`w-full bg-surface rounded-lg border border-border ${
            compact
              ? 'h-[400px] sm:h-[500px] lg:h-[600px] xl:h-[700px] 2xl:h-[800px]'
              : 'h-[400px] sm:h-[500px] lg:h-[70vh] lg:min-h-[600px]'
          }`}
        />
        <div className="absolute bottom-4 right-4 flex gap-2">
          {groups && (() => {
            const bubblesActive = resolveGraphMode(localGraphMode) === 'bubbles';
            const label = bubblesActive ? t('showIndividuals') : t('showAsGroups');
            return (
              <>
                <button
                  onClick={async () => {
                    const next: 'individuals' | 'bubbles' = bubblesActive ? 'individuals' : 'bubbles';
                    setLocalGraphMode(next);
                    try {
                      await fetch('/api/user/graph-display', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ graphMode: next }),
                      });
                    } catch {
                      // Silent fail - local state is source of truth until next page load.
                    }
                  }}
                  className={`p-3 border rounded-lg transition-colors ${
                    bubblesActive
                      ? 'bg-primary/20 border-primary/40 dark:bg-primary dark:border-primary'
                      : 'bg-surface border-border hover:bg-surface-elevated'
                  }`}
                  aria-label={label}
                  title={label}
                >
                  <svg className="w-5 h-5 text-primary dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle cx="8" cy="8" r="4" strokeWidth="2"/>
                    <circle cx="16" cy="16" r="4" strokeWidth="2"/>
                  </svg>
                </button>
                {bubblesActive && expandedBubbles.size > 0 && (
                  <button
                    onClick={() => setExpandedBubbles(new Set())}
                    className="p-3 bg-surface border border-border rounded-lg hover:bg-surface-elevated transition-colors"
                    aria-label={t('collapseAllGroups')}
                    title={t('collapseAllGroups')}
                  >
                    <svg
                      className="w-5 h-5 text-primary dark:text-white"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <polyline points="4 14 10 14 10 20" />
                      <polyline points="20 10 14 10 14 4" />
                      <line x1="14" y1="10" x2="21" y2="3" />
                      <line x1="3" y1="21" x2="10" y2="14" />
                    </svg>
                  </button>
                )}
              </>
            );
          })()}
          <button
            onClick={() => setView(viewMode === '3d' ? 'flat' : '3d')}
            className={`p-3 border rounded-lg transition-colors ${
              viewMode === '3d'
                ? 'bg-primary/20 border-primary/40 dark:bg-primary dark:border-primary'
                : 'bg-surface border-border hover:bg-surface-elevated'
            }`}
            aria-label={viewMode === '3d' ? t('switchToFlat') : t('switchTo3d')}
            aria-pressed={viewMode === '3d'}
            title={viewMode === '3d' ? t('switchToFlat') : t('switchTo3d')}
          >
            <svg
              className="w-5 h-5 text-primary dark:text-white"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path d="M12 2l9 5v10l-9 5-9-5V7z" />
              <path d="M3 7l9 5 9-5" />
              <path d="M12 12v10" />
            </svg>
          </button>
          <button
            onClick={recenterGraph}
            className="p-3 bg-surface border border-border rounded-lg hover:bg-surface-elevated transition-colors"
            aria-label={t('recenterGraph')}
            title={t('recenterGraph')}
          >
            <svg
              className="w-5 h-5 text-primary dark:text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <circle cx="12" cy="12" r="10" strokeWidth="2" />
              <circle cx="12" cy="12" r="3" strokeWidth="2" fill="currentColor" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2v4m0 12v4M2 12h4m12 0h4" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
