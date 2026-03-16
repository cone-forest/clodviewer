import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { HierarchyJson, Cluster } from '../../types';
import type { HierarchyStats } from '../../types/hierarchyStats';
import { HierarchySummaryPanel } from '../../components/HierarchySummaryPanel';
import './Dag3dView.css';

/** Above this cluster count, show only groups by default; click a group to show its clusters. */
const GROUP_ONLY_THRESHOLD = 1500;

/** Link distance for cluster→group edges (compact). */
const LINK_DISTANCE_CLUSTER_GROUP = 60;
/** Link distance for group→group edges (more separation for readability). */
const LINK_DISTANCE_GROUP_GROUP = 140;

// Classic red→green color scale (same as 2D DAG view).
const CLUSTER_COLORS_WARM = ['#7F0000', '#C00000', '#FF8000', '#A0FF00', '#008000'];
const GROUP_COLORS_COOL = ['#7F0000', '#C00000', '#FF8000', '#A0FF00', '#008000'];

interface DagNode {
  id: string;
  type: 'group' | 'cluster';
  groupId?: number;
  clusterIndex?: number;
  depth: number;
  x?: number;
  y?: number;
  z?: number;
  /** First simulation run result (plane 1) */
  x1?: number;
  y1?: number;
  boundaryRatio?: number;
}

interface DagLink {
  source: string | DagNode;
  target: string | DagNode;
  linkType: 'cluster-group' | 'group-group';
}

interface Dag3dViewProps {
  hierarchy: HierarchyJson;
  stats: HierarchyStats | null;
}

function getBoundaryRatio(c: Cluster): number {
  const inner = c.boundaryInner ?? 0;
  const outer = c.boundaryOuter ?? 0;
  if (outer > 0) return inner / outer;
  if (inner > 0) return Infinity;
  return 0;
}

function getGroupParentGroupIds(groupId: number, clusters: Cluster[]): number[] {
  const parentIds = new Set<number>();
  for (const c of clusters) {
    if (c.groupId === groupId && c.refined >= 0) parentIds.add(c.refined);
  }
  return [...parentIds];
}

/** Parse hex color to 0–1 RGB for vertex colors. */
function hexToRgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

export function Dag3dView({ hierarchy, stats }: Dag3dViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const pointsGroupRef = useRef<THREE.Points | null>(null);
  const pointsClusterRef = useRef<THREE.Points | null>(null);
  const lineSegmentsGroupRef = useRef<THREE.LineSegments | null>(null);
  const lineSegmentsClusterRef = useRef<THREE.LineSegments | null>(null);
  const animationIdRef = useRef<number | null>(null);
  const sim2Ref = useRef<d3.Simulation<DagNode, DagLink> | null>(null);
  const updateLayoutRef = useRef<
    (nodes: DagNode[], links: DagLink[], ratioToGroupColor: (r: number) => string, ratioToClusterColor: (r: number) => string) => void
  >(() => {});

  // No group expansion in 3D for v1: when over threshold, show groups only.
  const expandedGroupForLayout: number | null = null;

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const observer = new ResizeObserver(() => {
      setDimensions({
        width: el.clientWidth || 800,
        height: Math.max(400, el.clientHeight || 500),
      });
    });
    observer.observe(el);
    setDimensions({
      width: el.clientWidth || 800,
      height: Math.max(400, el.clientHeight || 500),
    });
    return () => observer.disconnect();
  }, []);

  // Resize camera and renderer when dimensions change
  useEffect(() => {
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    if (!camera || !renderer) return;
    const { width, height } = dimensions;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }, [dimensions]);

  // Three.js init and animation loop (run once when canvas is available)
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const width = container.clientWidth || 800;
    const height = Math.max(400, container.clientHeight || 500);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 10000);
    camera.position.set(0, 0, 500);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    // Ambient light so points are visible
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));

    // Placeholder geometry for points and lines (updated when layout is ready)
    const pointsGroupGeom = new THREE.BufferGeometry();
    const pointsClusterGeom = new THREE.BufferGeometry();
    const lineGroupGeom = new THREE.BufferGeometry();
    const lineClusterGeom = new THREE.BufferGeometry();

    const pointsGroup = new THREE.Points(
      pointsGroupGeom,
      new THREE.PointsMaterial({
        size: 10,
        vertexColors: true,
        sizeAttenuation: true,
      })
    );
    const pointsCluster = new THREE.Points(
      pointsClusterGeom,
      new THREE.PointsMaterial({
        size: 5,
        vertexColors: true,
        sizeAttenuation: true,
      })
    );
    scene.add(pointsGroup);
    scene.add(pointsCluster);
    pointsGroupRef.current = pointsGroup;
    pointsClusterRef.current = pointsCluster;

    const lineGroup = new THREE.LineSegments(
      lineGroupGeom,
      new THREE.LineBasicMaterial({ color: 0x6a6a8a, opacity: 0.8, transparent: true })
    );
    const lineCluster = new THREE.LineSegments(
      lineClusterGeom,
      new THREE.LineBasicMaterial({ color: 0x555555, opacity: 0.6, transparent: true })
    );
    scene.add(lineGroup);
    scene.add(lineCluster);
    lineSegmentsGroupRef.current = lineGroup;
    lineSegmentsClusterRef.current = lineCluster;

    updateLayoutRef.current = (
      nodes: DagNode[],
      links: DagLink[],
      ratioToGroupColor: (r: number) => string,
      ratioToClusterColor: (r: number) => string
    ) => {
      const groupNodes = nodes.filter((n) => n.type === 'group');
      const clusterNodes = nodes.filter((n) => n.type === 'cluster');

      // Nodes already have (x, y, z) from the two-plane combination in the layout effect
      if (groupNodes.length > 0) {
        const positions = new Float32Array(groupNodes.length * 3);
        const colors = new Float32Array(groupNodes.length * 3);
        groupNodes.forEach((n, i) => {
          positions[i * 3] = n.x ?? 0;
          positions[i * 3 + 1] = n.y ?? 0;
          positions[i * 3 + 2] = n.z ?? 0;
          const [r, g, b] = hexToRgb(
            n.boundaryRatio != null ? ratioToGroupColor(n.boundaryRatio) : GROUP_COLORS_COOL[0]
          );
          colors[i * 3] = r;
          colors[i * 3 + 1] = g;
          colors[i * 3 + 2] = b;
        });
        pointsGroupGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        pointsGroupGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        pointsGroupGeom.attributes.position.needsUpdate = true;
        pointsGroupGeom.attributes.color.needsUpdate = true;
      }
      pointsGroupGeom.setDrawRange(0, groupNodes.length);

      if (clusterNodes.length > 0) {
        const positions = new Float32Array(clusterNodes.length * 3);
        const colors = new Float32Array(clusterNodes.length * 3);
        clusterNodes.forEach((n, i) => {
          positions[i * 3] = n.x ?? 0;
          positions[i * 3 + 1] = n.y ?? 0;
          positions[i * 3 + 2] = n.z ?? 0;
          const [r, g, b] = hexToRgb(
            n.boundaryRatio != null ? ratioToClusterColor(n.boundaryRatio) : CLUSTER_COLORS_WARM[0]
          );
          colors[i * 3] = r;
          colors[i * 3 + 1] = g;
          colors[i * 3 + 2] = b;
        });
        pointsClusterGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        pointsClusterGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        pointsClusterGeom.attributes.position.needsUpdate = true;
        pointsClusterGeom.attributes.color.needsUpdate = true;
      }
      pointsClusterGeom.setDrawRange(0, clusterNodes.length);

      const groupGroupLinks = links.filter((l) => l.linkType === 'group-group');
      const clusterGroupLinks = links.filter((l) => l.linkType === 'cluster-group');

      const nodeById = new Map<string, DagNode>();
      nodes.forEach((n) => nodeById.set(n.id, n));
      const getPos = (src: string | DagNode): [number, number, number] => {
        const node = typeof src === 'string' ? nodeById.get(src) : src;
        return [node?.x ?? 0, node?.y ?? 0, node?.z ?? 0];
      };

      if (groupGroupLinks.length > 0) {
        const posArray = new Float32Array(groupGroupLinks.length * 2 * 3);
        groupGroupLinks.forEach((l, i) => {
          const [x1, y1, z1] = getPos(l.source);
          const [x2, y2, z2] = getPos(l.target);
          posArray[i * 6] = x1;
          posArray[i * 6 + 1] = y1;
          posArray[i * 6 + 2] = z1;
          posArray[i * 6 + 3] = x2;
          posArray[i * 6 + 4] = y2;
          posArray[i * 6 + 5] = z2;
        });
        lineGroupGeom.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        lineGroupGeom.attributes.position.needsUpdate = true;
      }
      lineGroupGeom.setDrawRange(0, groupGroupLinks.length * 2);

      if (clusterGroupLinks.length > 0) {
        const posArray = new Float32Array(clusterGroupLinks.length * 2 * 3);
        clusterGroupLinks.forEach((l, i) => {
          const [x1, y1, z1] = getPos(l.source);
          const [x2, y2, z2] = getPos(l.target);
          posArray[i * 6] = x1;
          posArray[i * 6 + 1] = y1;
          posArray[i * 6 + 2] = z1;
          posArray[i * 6 + 3] = x2;
          posArray[i * 6 + 4] = y2;
          posArray[i * 6 + 5] = z2;
        });
        lineClusterGeom.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        lineClusterGeom.attributes.position.needsUpdate = true;
      }
      lineClusterGeom.setDrawRange(0, clusterGroupLinks.length * 2);
    };

    function animate() {
      animationIdRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      if (animationIdRef.current != null) cancelAnimationFrame(animationIdRef.current);
      controls.dispose();
      renderer.dispose();
      pointsGroupGeom.dispose();
      pointsClusterGeom.dispose();
      lineGroupGeom.dispose();
      lineClusterGeom.dispose();
      (pointsGroup.material as THREE.Material).dispose();
      (pointsCluster.material as THREE.Material).dispose();
      (lineGroup.material as THREE.Material).dispose();
      (lineCluster.material as THREE.Material).dispose();
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
      pointsGroupRef.current = null;
      pointsClusterRef.current = null;
      lineSegmentsGroupRef.current = null;
      lineSegmentsClusterRef.current = null;
    };
  }, []);

  // Graph build and D3 layout; when sim ends, update Three.js scene
  useEffect(() => {
    if (!hierarchy.groups.length || !hierarchy.clusters.length) return;

    const groups = hierarchy.groups;
    const clusters = hierarchy.clusters;
    const { width, height } = dimensions;

    const maxDepth = groups.length ? Math.max(...groups.map((g) => g.depth)) : 0;
    const padding = 60;
    const ySpan = height - 2 * padding;
    // Root (depth 0) at top, leaves (maxDepth) at bottom
    const depthToY = (depth: number) =>
      padding + depth * (maxDepth > 0 ? ySpan / maxDepth : 0);

    const groupInnerSum = new Array(groups.length).fill(0);
    const groupOuterSum = new Array(groups.length).fill(0);
    clusters.forEach((c) => {
      if (c.groupId >= 0 && c.groupId < groups.length) {
        groupInnerSum[c.groupId] += c.boundaryInner ?? 0;
        groupOuterSum[c.groupId] += c.boundaryOuter ?? 0;
      }
    });

    const groupOnlyMode = clusters.length > GROUP_ONLY_THRESHOLD;
    const showClustersForGroup =
      !groupOnlyMode ||
      (expandedGroupForLayout != null &&
        expandedGroupForLayout >= 0 &&
        expandedGroupForLayout < groups.length);
    const visibleClusterIndices = !showClustersForGroup
      ? []
      : groupOnlyMode && expandedGroupForLayout != null
        ? clusters
            .map((c, i) => (c.groupId === expandedGroupForLayout ? i : -1))
            .filter((i) => i >= 0)
        : clusters.map((_, i) => i);

    const nodes: DagNode[] = [];
    groups.forEach((_, i) => {
      const inner = groupInnerSum[i];
      const outer = groupOuterSum[i];
      let ratio = 0;
      if (outer > 0) ratio = inner / outer;
      else if (inner > 0) ratio = Infinity;
      nodes.push({
        id: `g${i}`,
        type: 'group',
        groupId: i,
        depth: groups[i].depth,
        boundaryRatio: ratio,
      });
    });
    visibleClusterIndices.forEach((i) => {
      const c = clusters[i];
      const ratio = getBoundaryRatio(c);
      nodes.push({
        id: `c${i}`,
        type: 'cluster',
        groupId: c.groupId,
        clusterIndex: i,
        depth: groups[c.groupId].depth,
        boundaryRatio: ratio,
      });
    });

    const links: DagLink[] = [];
    const groupParentAdded = new Set<string>();
    groups.forEach((_, gId) => {
      const parentIds = getGroupParentGroupIds(gId, clusters);
      for (const parentId of parentIds) {
        if (parentId >= 0 && parentId < groups.length) {
          const key = `g${gId}-g${parentId}`;
          if (!groupParentAdded.has(key)) {
            groupParentAdded.add(key);
            links.push({ source: `g${gId}`, target: `g${parentId}`, linkType: 'group-group' });
          }
        }
      }
    });
    visibleClusterIndices.forEach((i) => {
      const c = clusters[i];
      if (c.groupId >= 0 && c.groupId < groups.length) {
        links.push({ source: `c${i}`, target: `g${c.groupId}`, linkType: 'cluster-group' });
      }
    });

    const clusterRatios = nodes
      .filter((n): n is DagNode & { boundaryRatio: number } => n.type === 'cluster' && n.boundaryRatio != null)
      .map((n) => n.boundaryRatio);
    const groupRatios = nodes
      .filter((n): n is DagNode & { boundaryRatio: number } => n.type === 'group' && n.boundaryRatio != null)
      .map((n) => n.boundaryRatio);

    const clusterFinite = clusterRatios.filter((r) => Number.isFinite(r));
    const groupFinite = groupRatios.filter((r) => Number.isFinite(r));
    const minCluster = clusterFinite.length ? Math.min(...clusterFinite) : 0;
    const maxCluster = clusterFinite.length ? Math.max(...clusterFinite) : 1;
    const domainMaxCluster = minCluster === maxCluster ? minCluster + 1 : maxCluster;
    const spanCluster = domainMaxCluster - minCluster || 1;
    const minGroup = groupFinite.length ? Math.min(...groupFinite) : 0;
    const maxGroup = groupFinite.length ? Math.max(...groupFinite) : 1;
    const domainMaxGroup = minGroup === maxGroup ? minGroup + 1 : maxGroup;
    const spanGroup = domainMaxGroup - minGroup || 1;

    const clusterDomain = CLUSTER_COLORS_WARM.map(
      (_, i) => minCluster + (spanCluster * i) / Math.max(1, CLUSTER_COLORS_WARM.length - 1)
    );
    const groupDomain = GROUP_COLORS_COOL.map(
      (_, i) => minGroup + (spanGroup * i) / Math.max(1, GROUP_COLORS_COOL.length - 1)
    );
    const clusterColorScale = d3.scaleLinear<string>().domain(clusterDomain).range(CLUSTER_COLORS_WARM).clamp(true);
    const groupColorScale = d3.scaleLinear<string>().domain(groupDomain).range(GROUP_COLORS_COOL).clamp(true);

    const ratioToClusterColor = (r: number) => {
      if (!clusterRatios.length) return CLUSTER_COLORS_WARM[0];
      if (r === Infinity) return CLUSTER_COLORS_WARM[CLUSTER_COLORS_WARM.length - 1];
      return clusterColorScale(Number.isFinite(r) ? r : minCluster);
    };
    const ratioToGroupColor = (r: number) => {
      if (!groupRatios.length) return GROUP_COLORS_COOL[0];
      if (r === Infinity) return GROUP_COLORS_COOL[GROUP_COLORS_COOL.length - 1];
      return groupColorScale(Number.isFinite(r) ? r : minGroup);
    };

    function makeSimulation(initialX: (n: DagNode) => number, initialY: (n: DagNode) => number) {
      nodes.forEach((n) => {
        n.x = initialX(n);
        n.y = initialY(n);
      });
      return d3
        .forceSimulation<DagNode>(nodes)
        .force(
          'link',
          d3
            .forceLink<DagNode, DagLink>(links)
            .id((d) => d.id)
            .distance((d) =>
              d.linkType === 'group-group' ? LINK_DISTANCE_GROUP_GROUP : LINK_DISTANCE_CLUSTER_GROUP
            )
        )
        .force('charge', d3.forceManyBody().strength(-120))
        .force('x', d3.forceX(width / 2).strength(0.05))
        .force('y', d3.forceY((d: DagNode) => depthToY(d.depth)).strength(0.9))
        .force('collision', d3.forceCollide().radius(12));
    }

    const simulation = makeSimulation(
      () => width / 2,
      (n) => depthToY(n.depth)
    );

    simulation.on('end', () => {
      // Plane 1: save first run
      nodes.forEach((n) => {
        n.x1 = n.x;
        n.y1 = n.y;
      });

      // Re-initialize for second run (slightly randomized so we get a different layout)
      const rnd = (): number => (Math.random() - 0.5) * 40;
      const sim2 = makeSimulation(
        () => width / 2 + rnd(),
        (n) => depthToY(n.depth) + rnd()
      );
      sim2Ref.current = sim2;

      sim2.on('end', () => {
        sim2Ref.current = null;

        // Bounds for plane 1 (x1, y1) and plane 2 (x, y)
        const x1s = nodes.map((n) => n.x1 ?? 0);
        const y1s = nodes.map((n) => n.y1 ?? 0);
        const x2s = nodes.map((n) => n.x ?? 0);
        const min = (a: number[]) => Math.min(...a);
        const max = (a: number[]) => Math.max(...a);
        const range = (a: number[]) => (max(a) - min(a)) || 1;
        const norm = (v: number, lo: number, r: number) => (r ? (v - lo) / r : 0.5);
        const R = 0.4 * Math.max(width, height);

        // Interpret as two planes: plane 1 → (x, y), plane 2 → z (use x2 as depth)
        nodes.forEach((n) => {
          const x1 = n.x1 ?? 0;
          const y1 = n.y1 ?? 0;
          const x2 = n.x ?? 0;
          const n1x = 2 * norm(x1, min(x1s), range(x1s)) - 1;
          const n1y = 2 * norm(y1, min(y1s), range(y1s)) - 1;
          const n2x = 2 * norm(x2, min(x2s), range(x2s)) - 1;
          n.x = R * n1x;
          n.y = R * n1y;
          n.z = R * n2x;
        });

        updateLayoutRef.current(nodes, links, ratioToGroupColor, ratioToClusterColor);
      });
    });

    return () => {
      simulation.stop();
      if (sim2Ref.current) {
        sim2Ref.current.stop();
        sim2Ref.current = null;
      }
    };
  }, [hierarchy, dimensions, expandedGroupForLayout]);

  return (
    <div className="view-container dag3d-view" data-view="dag3d">
      <h2>3D DAG View</h2>
      <p className="view-description">
        Same graph as 2D DAG: nodes (groups + clusters) colored by boundary ratio (red → green).
        Rotate, zoom, and pan with the mouse. Edges: group–group (lighter), cluster–group (darker).
        {hierarchy.clusters.length > GROUP_ONLY_THRESHOLD &&
          ' For large graphs only groups are shown; click a group to expand its clusters.'}
      </p>
      {hierarchy.clusters.length > GROUP_ONLY_THRESHOLD && (
        <p className="dag3d-group-only-note">Only groups are shown for large graphs.</p>
      )}
      <div className="dag3d-canvas-wrap" ref={containerRef}>
        <canvas ref={canvasRef} className="dag3d-canvas" />
      </div>

      {stats && (
        <div className="view-below">
          <HierarchySummaryPanel hierarchy={hierarchy} stats={stats} />
        </div>
      )}
    </div>
  );
}
