import { useEffect, useRef, useState, useMemo } from 'react';
import { renderComparison, DEFAULT_RENDER_SIZE } from './renderDiff';
import { buildLodMesh, getMaxError } from './lodMesh';
import type { HierarchyJson } from '../../types';
import type { HierarchyStats } from '../../types/hierarchyStats';
import { HierarchySummaryPanel } from '../../components/HierarchySummaryPanel';

interface GeneratorComparisonViewProps {
  hierarchy1: HierarchyJson | null;
  hierarchy2: HierarchyJson | null;
  generator1Label: string;
  generator2Label: string;
  stats: HierarchyStats | null;
}

function getMesh(h: HierarchyJson | null): { vertices: [number, number, number][]; indices: number[] } | null {
  if (!h) return null;
  if (!h.mesh?.vertices?.length || !h.mesh?.indices?.length) return null;
  return { vertices: h.mesh.vertices, indices: h.mesh.indices };
}

const MIN_RENDER_SIZE = 256;
const MAX_RENDER_SIZE = 512;

export function GeneratorComparisonView({
  hierarchy1,
  hierarchy2,
  generator1Label,
  generator2Label,
  stats,
}: GeneratorComparisonViewProps) {
  const leftRef = useRef<HTMLCanvasElement>(null);
  const rightRef = useRef<HTMLCanvasElement>(null);
  const panelsRef = useRef<HTMLDivElement>(null);

  const [comparisonMode, setComparisonMode] = useState<'full' | 'lod'>('full');
  const [renderSize, setRenderSize] = useState(DEFAULT_RENDER_SIZE);
  const [maxError, setMaxError] = useState(0);
  const [showDiff, setShowDiff] = useState(true);

  const meshRef = getMesh(hierarchy1) ?? getMesh(hierarchy2);
  const fullMesh1 = getMesh(hierarchy1);
  const fullMesh2 = getMesh(hierarchy2);

  const maxErrorBound = useMemo(() => {
    const m1 = hierarchy1 ? getMaxError(hierarchy1) : 0;
    const m2 = hierarchy2 ? getMaxError(hierarchy2) : 0;
    return Math.max(m1, m2, 1e-6);
  }, [hierarchy1, hierarchy2]);

  const mesh1 = useMemo(() => {
    if (!fullMesh1 || !hierarchy1) return null;
    if (comparisonMode === 'full') return fullMesh1;
    const lod = buildLodMesh(hierarchy1, maxError);
    return lod ?? fullMesh1;
  }, [fullMesh1, hierarchy1, comparisonMode, maxError]);

  const mesh2 = useMemo(() => {
    if (!fullMesh2 || !hierarchy2) return null;
    if (comparisonMode === 'full') return fullMesh2;
    const lod = buildLodMesh(hierarchy2, maxError);
    return lod ?? fullMesh2;
  }, [fullMesh2, hierarchy2, comparisonMode, maxError]);

  useEffect(() => {
    const el = panelsRef.current;
    if (!el) return;
    const updateSize = () => {
      const w = el.clientWidth;
      const gap = 16;
      const perPanel = (w - gap) / 2;
      const size = Math.floor(Math.min(MAX_RENDER_SIZE, Math.max(MIN_RENDER_SIZE, perPanel)));
      setRenderSize(size);
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!leftRef.current || !rightRef.current || !meshRef || !mesh1 || !mesh2) return;
    const leftCanvas = leftRef.current;
    const rightCanvas = rightRef.current;
    renderComparison(meshRef, mesh1, mesh2, leftCanvas, rightCanvas, { showDiff, size: renderSize });
    return () => {
      // No async work; cleanup for consistency if effect re-runs or unmounts
    };
  }, [meshRef, mesh1, mesh2, showDiff, renderSize]);

  if (!hierarchy1 && !hierarchy2) {
    return (
      <div className="view-container" data-view="comparison">
        <h2>Generator Comparison View</h2>
        <p className="view-description">Load a hierarchy JSON for the left panel above, then use &quot;Load hierarchy JSON&quot; for the right panel.</p>
        {stats && hierarchy1 && (
          <HierarchySummaryPanel hierarchy={hierarchy1} stats={stats} />
        )}
      </div>
    );
  }

  if (!meshRef || !fullMesh1 || !fullMesh2) {
    return (
      <div className="view-container" data-view="comparison">
        <h2>Generator Comparison View</h2>
        <p className="error">
          {!hierarchy1
            ? 'Load a hierarchy for the left panel.'
            : !hierarchy2
              ? 'Load a hierarchy for the right panel (second button in the bar).'
              : 'Both hierarchy files must include mesh data (vertices and indices) for comparison.'}
        </p>
        {stats && hierarchy1 && (
          <HierarchySummaryPanel hierarchy={hierarchy1} stats={stats} />
        )}
      </div>
    );
  }

  return (
    <div className="view-container view-comparison" data-view="comparison">
      <h2>Generator Comparison View</h2>
      <p className="view-description">
        {showDiff
          ? 'Side-by-side diff: (lib − src). Red = pixel difference from reference mesh. Same camera for both.'
          : 'Side-by-side lib render. Same camera for both.'}
      </p>
      <p className="view-reference">
        Reference (src): first hierarchy (left generator).
      </p>
      <p className="view-strategy">
        {comparisonMode === 'full'
          ? 'Full mesh comparison: ref and lib are the full meshes from each hierarchy.'
          : 'LOD comparison: ref = full mesh; lib = mesh from clusters with error ≤ threshold.'}
      </p>
      <div className="comparison-controls">
        <label className="comparison-control">
          <input
            type="checkbox"
            checked={showDiff}
            onChange={(e) => setShowDiff(e.target.checked)}
          />
          Show diff (lib − src)
        </label>
        <div className="comparison-control">
          <label>Mode</label>
          <select
            value={comparisonMode}
            onChange={(e) => setComparisonMode(e.target.value as 'full' | 'lod')}
          >
            <option value="full">Full mesh</option>
            <option value="lod">LOD (by error threshold)</option>
          </select>
        </div>
        {comparisonMode === 'lod' && (
          <div className="comparison-control">
            <label>Max error</label>
            <input
              type="range"
              min={0}
              max={maxErrorBound}
              step={maxErrorBound / 100}
              value={maxError}
              onChange={(e) => setMaxError(Number(e.target.value))}
            />
            <span className="comparison-control-value">{maxError.toExponential(2)}</span>
          </div>
        )}
      </div>
      <div className="comparison-panels" ref={panelsRef}>
        <div className="panel">
          <h3>{generator1Label}</h3>
          <canvas
            ref={leftRef}
            width={renderSize}
            height={renderSize}
            style={{ width: '100%', maxWidth: 400, background: '#111' }}
          />
        </div>
        <div className="panel">
          <h3>{generator2Label}</h3>
          <canvas
            ref={rightRef}
            width={renderSize}
            height={renderSize}
            style={{ width: '100%', maxWidth: 400, background: '#111' }}
          />
        </div>
      </div>
      {stats && hierarchy1 && (
        <div className="view-below">
          <HierarchySummaryPanel hierarchy={hierarchy1} stats={stats} />
        </div>
      )}
    </div>
  );
}
