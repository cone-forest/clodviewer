import { useState, useCallback, useMemo } from 'react';
import type { HierarchyJson, ViewId } from './types';
import type { HierarchyStats } from './types/hierarchyStats';
import { DagStructureView } from './views/DagStructureView';
import { Dag3dView } from './views/Dag3dView';
import { ErrorTreemapView } from './views/ErrorTreemapView';
import { GeneratorComparisonView } from './views/GeneratorComparisonView';
import { HierarchySummaryPanel } from './components/HierarchySummaryPanel';
import { computeHierarchyStats } from './utils/hierarchyStats';
import './App.css';

function parseHierarchyJson(text: string): HierarchyJson {
  const raw = JSON.parse(text);
  return {
    mesh: raw.mesh,
    groups: raw.groups ?? [],
    clusters: raw.clusters ?? [],
  };
}

function loadFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    };
    input.click();
  });
}

export default function App() {
  const [hierarchy, setHierarchy] = useState<HierarchyJson | null>(null);
  const [hierarchy2, setHierarchy2] = useState<HierarchyJson | null>(null);
  const [activeView, setActiveView] = useState<ViewId | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const stats: HierarchyStats | null = useMemo(
    () => (hierarchy ? computeHierarchyStats(hierarchy) : null),
    [hierarchy]
  );

  const handleLoadHierarchy = useCallback(async () => {
    setLoadError(null);
    try {
      const text = await loadFile();
      const data = parseHierarchyJson(text);
      if (!data.groups?.length && !data.clusters?.length) {
        setLoadError('Invalid hierarchy: no groups or clusters');
        return;
      }
      setHierarchy(data);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load file');
    }
  }, []);

  const handleLoadHierarchy2 = useCallback(async () => {
    setLoadError(null);
    try {
      const text = await loadFile();
      const data = parseHierarchyJson(text);
      if (!data.groups?.length && !data.clusters?.length) {
        setLoadError('Invalid hierarchy: no groups or clusters');
        return;
      }
      setHierarchy2(data);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load file');
    }
  }, []);

  const canShowDag = hierarchy != null;
  const canShowTreemap = hierarchy != null;

  return (
    <div className="app">
      <header className="shell-header">
        <h1>Cluster LOD Visualization</h1>
        <div className="shell-controls">
          <div className="control-group">
            <label>Hierarchy</label>
            <button type="button" onClick={handleLoadHierarchy}>
              {hierarchy ? `Loaded (${hierarchy.clusters.length} clusters)` : 'Load hierarchy JSON…'}
            </button>
          </div>
          {activeView === 'comparison' && (
            <div className="control-group">
              <label>Hierarchy (right)</label>
              <button type="button" onClick={handleLoadHierarchy2}>
                {hierarchy2 ? `Loaded (${hierarchy2.clusters.length} clusters)` : 'Load hierarchy JSON…'}
              </button>
            </div>
          )}
          <div className="view-buttons">
            <button
              type="button"
              className={activeView === 'dag' ? 'active' : ''}
              disabled={!canShowDag}
              onClick={() => setActiveView('dag')}
            >
              2D DAG View
            </button>
            <button
              type="button"
              className={activeView === 'dag3d' ? 'active' : ''}
              disabled={!canShowDag}
              onClick={() => setActiveView('dag3d')}
            >
              3D DAG View
            </button>
            <button
              type="button"
              className={activeView === 'treemap' ? 'active' : ''}
              disabled={!canShowTreemap}
              onClick={() => setActiveView('treemap')}
            >
              Error Treemap View
            </button>
            <button
              type="button"
              className={activeView === 'comparison' ? 'active' : ''}
              onClick={() => setActiveView('comparison')}
            >
              Generator Comparison View
            </button>
          </div>
        </div>
        {loadError && <p className="error">{loadError}</p>}
      </header>

      <main className="shell-main">
        {hierarchy == null && (
          <p className="placeholder">Load a hierarchy JSON above to begin.</p>
        )}
        {hierarchy != null && activeView == null && (
          <HierarchySummaryPanel hierarchy={hierarchy} stats={stats} />
        )}
        {hierarchy != null && activeView === 'dag' && (
          <>
            <DagStructureView hierarchy={hierarchy} stats={stats} />
          </>
        )}
        {hierarchy != null && activeView === 'dag3d' && (
          <>
            <Dag3dView hierarchy={hierarchy} stats={stats} />
          </>
        )}
        {hierarchy != null && activeView === 'treemap' && (
          <>
            <ErrorTreemapView hierarchy={hierarchy} stats={stats} />
          </>
        )}
        {activeView === 'comparison' && (
          <GeneratorComparisonView
            hierarchy1={hierarchy}
            hierarchy2={hierarchy2}
            generator1Label="Left"
            generator2Label="Right"
            stats={stats}
          />
        )}
      </main>
    </div>
  );
}
