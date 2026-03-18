import { useState } from 'react';
import type { HierarchyJson } from '../types';
import type { HierarchyStats } from '../types/hierarchyStats';
import { BoundaryRatioHistogram } from './BoundaryRatioHistogram';

const LOD_CLUSTER_COLOR = '#4fc3f7';
const LOD_TRIANGLE_COLOR = '#ffb74d';

function OccupancyMiniChart({
  distribution,
  fill,
  unitSingular,
}: {
  distribution: Record<number, number>;
  fill: string;
  unitSingular: string;
}) {
  const entries = Object.entries(distribution).sort(
    ([a], [b]) => Number(a) - Number(b),
  );
  const maxCount =
    entries.length > 0
      ? Math.max(...entries.map(([, c]) => c as number))
      : 0;
  return (
    <svg
      className="hierarchy-summary-occupancy"
      viewBox="0 0 80 24"
      preserveAspectRatio="none"
    >
      {entries.map(([key, count], i) => {
        const step = 80 / Math.max(1, entries.length);
        const barWidth = Math.max(4, step * 0.7);
        const x = step * i + (step - barWidth) / 2;
        const h = maxCount > 0 ? (18 * (count as number)) / maxCount : 0;
        const n = count as number;
        return (
          <g key={key}>
            <title>
              {key} {unitSingular}
              {Number(key) === 1 ? '' : 's'} · {n} meshlet{n === 1 ? '' : 's'}
            </title>
            <rect
              x={x}
              y={2}
              width={barWidth}
              height={20}
              fill="transparent"
            />
            <rect
              x={x}
              y={22 - h}
              width={barWidth}
              height={h}
              fill={fill}
            />
          </g>
        );
      })}
    </svg>
  );
}

interface HierarchySummaryPanelProps {
  hierarchy: HierarchyJson;
  stats: HierarchyStats | null;
}

export function HierarchySummaryPanel({
  hierarchy,
  stats,
}: HierarchySummaryPanelProps) {
  const [showLodClusters, setShowLodClusters] = useState(true);
  const [showLodTriangles, setShowLodTriangles] = useState(true);

  if (!stats) return null;

  const { levels, lodProgression, totalTriangles, maxDepth } = stats;
  const { allClusterRatios, allGroupRatios } = stats.boundaryRatios;

  const lodChartHeight = Math.max(80, levels.length * 32);
  const nLod = lodProgression.length;
  const xAt = (i: number) => 20 + (95 * i) / Math.max(1, nLod - 1);
  const yCluster = (r: number) => 70 - 60 * r;
  const yTri = (r: number) => 70 - 60 * r;

  return (
    <section className="hierarchy-summary">
      <h2 className="hierarchy-summary-title">Hierarchy Summary</h2>
      <p className="hierarchy-summary-meta">
        {hierarchy.clusters.length} clusters · {totalTriangles.toLocaleString()}{' '}
        triangles · max depth {maxDepth}
      </p>

      <div className="hierarchy-summary-grid">
        <div className="hierarchy-summary-levels">
          <h3>Per-depth stats</h3>
          <table className="hierarchy-summary-table">
            <thead>
              <tr>
                <th>Depth</th>
                <th>Clusters</th>
                <th>Triangles</th>
                <th>Occupancy (triangles → meshlets)</th>
                <th>Occupancy (vertices → meshlets)</th>
              </tr>
            </thead>
            <tbody>
              {levels.map((lvl) => (
                <tr key={lvl.depth}>
                  <td>{lvl.depth}</td>
                  <td>{lvl.clusterCount}</td>
                  <td>{lvl.triangleCount}</td>
                  <td>
                    <OccupancyMiniChart
                      distribution={lvl.occupancyDistribution}
                      fill="#9fa8da"
                      unitSingular="tri"
                    />
                  </td>
                  <td>
                    <OccupancyMiniChart
                      distribution={lvl.vertexOccupancyDistribution}
                      fill="#80cbc4"
                      unitSingular="vertex"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hierarchy-summary-occupancy-note">
            Spikes at very low triangle counts (e.g. 1–3) on coarser depths can
            indicate meshlets that barely simplified—sometimes &quot;stuck&quot;
            or disjoint geometry after hierarchy building.
          </p>
        </div>

        <div className="hierarchy-summary-lod">
          <h3>LOD progression (vs initial finest depth)</h3>
          <div className="hierarchy-summary-lod-toggles">
            <label className="hierarchy-summary-lod-toggle">
              <input
                type="checkbox"
                checked={showLodClusters}
                onChange={(e) => setShowLodClusters(e.target.checked)}
              />
              <span
                className="hierarchy-summary-lod-swatch"
                style={{ background: LOD_CLUSTER_COLOR }}
                aria-hidden
              />
              <span>Clusters / initial</span>
            </label>
            <label className="hierarchy-summary-lod-toggle">
              <input
                type="checkbox"
                checked={showLodTriangles}
                onChange={(e) => setShowLodTriangles(e.target.checked)}
              />
              <span
                className="hierarchy-summary-lod-swatch"
                style={{ background: LOD_TRIANGLE_COLOR }}
                aria-hidden
              />
              <span>Triangles / initial</span>
            </label>
          </div>
          <svg
            className="hierarchy-summary-lod-chart"
            viewBox="0 0 120 80"
            preserveAspectRatio="none"
            style={{ height: lodChartHeight }}
          >
            <line
              x1={20}
              y1={10}
              x2={20}
              y2={70}
              stroke="#555"
              strokeWidth={0.5}
            />
            <line
              x1={20}
              y1={70}
              x2={115}
              y2={70}
              stroke="#555"
              strokeWidth={0.5}
            />
            <text x={4} y={72} fontSize={6} fill="#888">
              0
            </text>
            <text x={4} y={16} fontSize={6} fill="#888">
              1
            </text>
            {lodProgression.map((p, i) => (
              <text
                key={`xt-${p.depth}`}
                x={xAt(i)}
                y={78}
                fontSize={5}
                fill="#888"
                textAnchor="middle"
              >
                {p.depth}
              </text>
            ))}
            {showLodClusters &&
              nLod > 1 &&
              lodProgression.map((p, i) => {
                if (i === 0) return null;
                const prev = lodProgression[i - 1];
                return (
                  <line
                    key={`cl-seg-${i}`}
                    x1={xAt(i - 1)}
                    y1={yCluster(prev.ratioToInitial)}
                    x2={xAt(i)}
                    y2={yCluster(p.ratioToInitial)}
                    stroke={LOD_CLUSTER_COLOR}
                    strokeWidth={1.5}
                  />
                );
              })}
            {showLodTriangles &&
              nLod > 1 &&
              lodProgression.map((p, i) => {
                if (i === 0) return null;
                const prev = lodProgression[i - 1];
                return (
                  <line
                    key={`tri-seg-${i}`}
                    x1={xAt(i - 1)}
                    y1={yTri(prev.triangleRatioToInitial)}
                    x2={xAt(i)}
                    y2={yTri(p.triangleRatioToInitial)}
                    stroke={LOD_TRIANGLE_COLOR}
                    strokeWidth={1.5}
                  />
                );
              })}
            {showLodClusters &&
              lodProgression.map((p, i) => (
                <circle
                  key={`cl-pt-${i}`}
                  cx={xAt(i)}
                  cy={yCluster(p.ratioToInitial)}
                  r={1.5}
                  fill="#ffffff"
                  stroke={LOD_CLUSTER_COLOR}
                  strokeWidth={0.5}
                >
                  <title>
                    {`Clusters: depth ${p.depth} · ${p.clusterCount} clusters · ${p.triangleCount.toLocaleString()} triangles · ratio ${p.ratioToInitial.toFixed(3)}`}
                  </title>
                </circle>
              ))}
            {showLodTriangles &&
              lodProgression.map((p, i) => (
                <circle
                  key={`tri-pt-${i}`}
                  cx={xAt(i)}
                  cy={yTri(p.triangleRatioToInitial)}
                  r={1.5}
                  fill="#ffffff"
                  stroke={LOD_TRIANGLE_COLOR}
                  strokeWidth={0.5}
                >
                  <title>
                    {`Triangles: depth ${p.depth} · ${p.triangleCount.toLocaleString()} triangles · ${p.clusterCount} clusters · ratio ${p.triangleRatioToInitial.toFixed(3)}`}
                  </title>
                </circle>
              ))}
          </svg>
        </div>
      </div>

      <div className="hierarchy-summary-boundary">
        <h3>Boundary ratio distributions</h3>
        <div className="hierarchy-summary-boundary-row">
          <div className="hierarchy-summary-boundary-col">
            <h4>All clusters</h4>
            <BoundaryRatioHistogram
              ratios={allClusterRatios}
              itemLabel="cluster"
            />
          </div>
          <div className="hierarchy-summary-boundary-col">
            <h4>All groups</h4>
            <BoundaryRatioHistogram ratios={allGroupRatios} itemLabel="group" />
          </div>
        </div>
      </div>
    </section>
  );
}
