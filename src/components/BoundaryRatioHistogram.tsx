const HISTOGRAM_BINS = 14;

export interface BoundaryRatioHistogramProps {
  ratios: number[];
  groupId?: number;
  onBarClick?: (min: number, max: number, groupId?: number) => void;
  highlightRange?: { min: number; max: number; groupId?: number } | null;
  itemLabel?: string;
  className?: string;
}

interface HistogramBinsResult {
  bins: [number, number][];
  counts: number[];
}

function histogramBins(
  ratios: number[],
  numBins: number = HISTOGRAM_BINS,
): HistogramBinsResult {
  if (ratios.length === 0) return { bins: [], counts: [] };
  const finite = ratios.filter((r) => Number.isFinite(r));
  const min = finite.length ? Math.min(...finite) : 0;
  const max = finite.length ? Math.max(...finite) : 1;
  const span = max - min || 1;
  const step = span / numBins;
  const bins: [number, number][] = [];
  const counts: number[] = [];
  for (let i = 0; i < numBins; i++) {
    const x0 = min + i * step;
    const x1 = i === numBins - 1 ? Infinity : min + (i + 1) * step;
    bins.push([x0, x1]);
    const inRange = (r: number) =>
      (Number.isFinite(r) &&
        (x1 === Infinity ? r >= x0 : r >= x0 && r < x1)) ||
      (r === Infinity && i === numBins - 1);
    counts.push(ratios.filter(inRange).length);
  }
  return { bins, counts };
}

function formatAxisValue(v: number): string {
  if (v === 0) return '0';
  if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0))
    return v.toExponential(1);
  if (Math.abs(v) < 1) return v.toFixed(2);
  return v.toFixed(1);
}

export function BoundaryRatioHistogram({
  ratios,
  groupId,
  onBarClick,
  highlightRange,
  itemLabel = 'cluster',
  className,
}: BoundaryRatioHistogramProps) {
  const { bins, counts } = histogramBins(ratios);
  const maxCount = Math.max(1, ...counts);
  const vbW = 100;
  const vbH = 60;
  const barW = bins.length > 0 ? vbW / bins.length : 0;
  const finiteRatios = ratios.filter((r) => Number.isFinite(r));
  const minR = finiteRatios.length ? Math.min(...finiteRatios) : 0;
  const maxR = finiteRatios.length ? Math.max(...finiteRatios) : 1;
  const axisTicks = 5;
  const axisValues = Array.from({ length: axisTicks }, (_, i) =>
    minR + (i / (axisTicks - 1)) * (maxR - minR),
  );
  const hasInf = ratios.some((r) => r === Infinity);
  const isBarSelected = (x0: number, x1: number) =>
    highlightRange != null &&
    highlightRange.min === x0 &&
    (x1 === Infinity
      ? highlightRange.max === Infinity
      : highlightRange.max === x1) &&
    (highlightRange.groupId === undefined ||
      highlightRange.groupId === groupId);

  return (
    <div className={className ?? 'dag-histogram-wrap'}>
      <svg
        className="dag-histogram"
        viewBox={`0 0 ${vbW} ${vbH}`}
        preserveAspectRatio="none"
      >
        {bins.map(([x0, x1], i) => {
          const selected = isBarSelected(x0, x1);
          return (
            <rect
              key={i}
              x={(i / bins.length) * vbW}
              y={vbH - (counts[i] / maxCount) * vbH}
              width={barW}
              height={(counts[i] / maxCount) * vbH}
              fill="currentColor"
              opacity={selected ? 1 : 0.7}
              className={onBarClick ? 'dag-histogram-bar-clickable' : ''}
              onClick={() => onBarClick?.(x0, x1, groupId)}
            >
              <title>
                {formatAxisValue(x0)} –{' '}
                {x1 === Infinity ? '∞' : formatAxisValue(x1)} · {counts[i]}{' '}
                {itemLabel}
                {counts[i] === 1 ? '' : 's'}
              </title>
            </rect>
          );
        })}
      </svg>
      <div className="dag-histogram-axis" aria-hidden="true">
        {axisValues.map((val, i) => (
          <span
            key={i}
            className="dag-histogram-tick"
            style={{
              left: `${(i / (axisTicks - 1)) * 100}%`,
              transform: 'translateX(-50%)',
            }}
          >
            {hasInf && i === axisTicks - 1 ? '∞' : formatAxisValue(val)}
          </span>
        ))}
      </div>
    </div>
  );
}

