import React from 'react';
import type { HierarchyJson } from '../types';
import type { HierarchyStats } from '../types/hierarchyStats';
import { BoundaryRatioHistogram } from './BoundaryRatioHistogram';

interface HierarchySummaryPanelProps {
  hierarchy: HierarchyJson;
  stats: HierarchyStats | null;
}

export function HierarchySummaryPanel({
  hierarchy,
  stats,
}: HierarchySummaryPanelProps) {
  if (!stats) return null;

  const { levels, lodProgression, totalClusters, totalTriangles, maxDepth } =
    stats;
  const { allClusterRatios, allGroupRatios } = stats.boundaryRatios;

  // Approximate chart height based on number of table rows so the visuals track each other.
  const lodChartHeight = Math.max(80, levels.length * 32);

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
              </tr>
            </thead>
            <tbody>
              {levels.map((lvl) => {
                const entries = Object.entries(lvl.occupancyDistribution).sort(
                  ([a], [b]) => Number(a) - Number(b),
                );
                const maxCount =
                  entries.length > 0
                    ? Math.max(...entries.map(([, c]) => c as number))
                    : 0;
                return (
                  <tr key={lvl.depth}>
                    <td>{lvl.depth}</td>
                    <td>{lvl.clusterCount}</td>
                    <td>{lvl.triangleCount}</td>
                    <td>
                      <svg
                        className="hierarchy-summary-occupancy"
                        viewBox="0 0 80 24"
                        preserveAspectRatio="none"
                      >
                        {entries.map(([triKey, count], i) => {
                          const step = 80 / Math.max(1, entries.length);
                          const barWidth = Math.max(4, step * 0.7);
                          const x = step * i + (step - barWidth) / 2;
                          const h =
                            maxCount > 0
                              ? (18 * (count as number)) / maxCount
                              : 0;
                          return (
                            <g key={triKey}>
                              <title>
                                {triKey} tris · {count} meshlet
                                {count === 1 ? '' : 's'}
                              </title>
                              {/* Invisible hit area for easier hover/click */}
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
                                fill="#9fa8da"
                              />
                            </g>
                          );
                        })}
                      </svg>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="hierarchy-summary-lod">
          <h3>LOD progression (clusters / initial)</h3>
          <svg
            className="hierarchy-summary-lod-chart"
            viewBox="0 0 120 80"
            preserveAspectRatio="none"
            style={{ height: lodChartHeight }}
          >
            {/* Axes */}
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
            {/* Y-axis labels (ratio) */}
            <text x={4} y={72} fontSize={6} fill="#888">
              0
            </text>
            <text x={4} y={16} fontSize={6} fill="#888">
              1
            </text>
            {/* X-axis labels (depths) */}
            {lodProgression.map((p, i) => {
              const x =
                20 +
                (95 * i) / Math.max(1, lodProgression.length - 1);
              return (
                <text
                  key={`xt-${p.depth}`}
                  x={x}
                  y={78}
                  fontSize={5}
                  fill="#888"
                  textAnchor="middle"
                >
                  {p.depth}
                </text>
              );
            })}
            {/* Curve */}
            {lodProgression.length > 1 &&
              lodProgression.map((p, i) => {
                if (i === 0) return null;
                const prev = lodProgression[i - 1];
                const x0 =
                  20 +
                  (95 * (i - 1)) /
                  Math.max(1, lodProgression.length - 1);
                const x1 =
                  20 +
                  (95 * i) /
                  Math.max(1, lodProgression.length - 1);
                const y0 = 70 - 60 * prev.ratioToInitial;
                const y1 = 70 - 60 * p.ratioToInitial;
                return (
                  <line
                    key={`seg-${i}`}
                    x1={x0}
                    y1={y0}
                    x2={x1}
                    y2={y1}
                    stroke="#4fc3f7"
                    strokeWidth={1.5}
                  />
                );
              })}
            {lodProgression.map((p, i) => {
              const x =
                20 +
                (95 * i) / Math.max(1, lodProgression.length - 1);
              const y = 70 - 60 * p.ratioToInitial;
              const level = levels.find((lvl) => lvl.depth === p.depth);
              const triLabel =
                level != null ? level.triangleCount.toLocaleString() : 'n/a';
              return (
                <circle
                  key={`pt-${i}`}
                  cx={x}
                  cy={y}
                  r={1.5}
                  fill="#ffffff"
                  stroke="#4fc3f7"
                  strokeWidth={0.5}
                >
                  <title>
                    depth {p.depth} · clusters {p.clusterCount} · triangles{' '}
                    {triLabel} · ratio {p.ratioToInitial.toFixed(3)}
                  </title>
                </circle>
              );
            })}
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

