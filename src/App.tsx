import { useState, useCallback } from 'react';
import type { HierarchyJson, ViewId } from './types';
import { DagStructureView } from './views/DagStructureView';
import { ErrorTreemapView } from './views/ErrorTreemapView';
import { GeneratorComparisonView } from './views/GeneratorComparisonView';
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
              DAG Structure View
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
        {activeView == null && (
          <p className="placeholder">Choose a view above to analyze the hierarchy.</p>
        )}
        {activeView === 'dag' && hierarchy && (
          <DagStructureView hierarchy={hierarchy} />
        )}
        {activeView === 'treemap' && hierarchy && (
          <ErrorTreemapView hierarchy={hierarchy} />
        )}
        {activeView === 'comparison' && (
          <GeneratorComparisonView
            hierarchy1={hierarchy}
            hierarchy2={hierarchy2}
            generator1Label="Left"
            generator2Label="Right"
          />
        )}
      </main>
    </div>
  );
}
