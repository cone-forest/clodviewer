import { useEffect, useRef } from 'react';
import { renderComparison } from './renderDiff';
import type { HierarchyJson } from '../../types';

interface GeneratorComparisonViewProps {
  hierarchy1: HierarchyJson;
  hierarchy2: HierarchyJson;
  generator1Label: string;
  generator2Label: string;
}

function getMesh(h: HierarchyJson): { vertices: [number, number, number][]; indices: number[] } | null {
  if (!h.mesh?.vertices?.length || !h.mesh?.indices?.length) return null;
  return { vertices: h.mesh.vertices, indices: h.mesh.indices };
}

export function GeneratorComparisonView({
  hierarchy1,
  hierarchy2,
  generator1Label,
  generator2Label,
}: GeneratorComparisonViewProps) {
  const leftRef = useRef<HTMLCanvasElement>(null);
  const rightRef = useRef<HTMLCanvasElement>(null);

  const meshRef = getMesh(hierarchy1) ?? getMesh(hierarchy2);
  const mesh1 = getMesh(hierarchy1);
  const mesh2 = getMesh(hierarchy2);

  useEffect(() => {
    if (!leftRef.current || !rightRef.current || !meshRef || !mesh1 || !mesh2) return;
    renderComparison(meshRef, mesh1, mesh2, leftRef.current, rightRef.current);
  }, [hierarchy1, hierarchy2, meshRef, mesh1, mesh2]);

  if (!meshRef || !mesh1 || !mesh2) {
    return (
      <div className="view-container" data-view="comparison">
        <h2>Generator Comparison View</h2>
        <p className="error">Both hierarchy files must include mesh data (vertices and indices) for comparison.</p>
      </div>
    );
  }

  return (
    <div className="view-container view-comparison" data-view="comparison">
      <h2>Generator Comparison View</h2>
      <p className="view-description">
        Side-by-side diff: (lib − src). Red = pixel difference from reference mesh. Same camera for both.
      </p>
      <div className="comparison-panels">
        <div className="panel">
          <h3>{generator1Label}</h3>
          <canvas ref={leftRef} width={512} height={512} style={{ width: '100%', maxWidth: 400, background: '#111' }} />
        </div>
        <div className="panel">
          <h3>{generator2Label}</h3>
          <canvas ref={rightRef} width={512} height={512} style={{ width: '100%', maxWidth: 400, background: '#111' }} />
        </div>
      </div>
    </div>
  );
}
