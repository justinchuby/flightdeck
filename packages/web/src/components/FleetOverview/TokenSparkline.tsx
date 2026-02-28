/**
 * TokenSparkline — tiny inline SVG sparkline for agent token usage over time.
 *
 * Data points are normalised to fit the viewBox height. A translucent red zone
 * above the 80 % threshold indicates high utilisation.
 */
import { useMemo } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────

export interface TokenSparklineProps {
  /** Token counts at regular polling intervals (oldest → newest). */
  dataPoints: number[];
  width?:  number;
  height?: number;
  color?:  string;
}

// ── Component ─────────────────────────────────────────────────────────────

export function TokenSparkline({
  dataPoints,
  width  = 80,
  height = 24,
  color  = '#58a6ff',
}: TokenSparklineProps) {
  const pad = 2;

  const { polylinePoints, lastX, lastY, overThreshold } = useMemo(() => {
    const filtered = dataPoints.filter(v => v >= 0);
    if (filtered.length < 2) {
      return { polylinePoints: '', lastX: 0, lastY: height / 2, overThreshold: false };
    }

    const max    = Math.max(...filtered);
    const drawW  = width  - pad * 2;
    const drawH  = height - pad * 2;
    const stepX  = drawW / (filtered.length - 1);
    const norm   = max === 0 ? filtered.map(() => 0) : filtered.map(v => v / max);

    const coords = norm.map((v, i) => {
      const x = pad + i * stepX;
      const y = pad + drawH * (1 - v); // higher value → lower y (up)
      return { x, y };
    });

    const pts      = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const lastPt   = coords[coords.length - 1];
    const lastNorm = norm[norm.length - 1];

    return {
      polylinePoints: pts,
      lastX:          lastPt.x,
      lastY:          lastPt.y,
      overThreshold:  lastNorm > 0.8,
    };
  }, [dataPoints, width, height]);

  // Empty / flat-line placeholder.
  if (!polylinePoints) {
    return (
      <svg
        width={width}
        height={height}
        aria-label="Token usage sparkline — no data"
        className="opacity-25"
      >
        <line
          x1={pad}
          y1={height / 2}
          x2={width - pad}
          y2={height / 2}
          stroke={color}
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      </svg>
    );
  }

  // Red-zone band: top 20 % of the draw area (y < redZoneY).
  const redZoneY = pad + (height - pad * 2) * 0.2;

  return (
    <svg
      width={width}
      height={height}
      overflow="visible"
      aria-label={`Token usage sparkline${overThreshold ? ' — above 80 % threshold' : ''}`}
    >
      {/* Red-zone background */}
      <rect
        x={pad}
        y={pad}
        width={width - pad * 2}
        height={redZoneY - pad}
        fill="rgba(239,68,68,0.08)"
        rx={1}
      />
      {/* Red-zone threshold line */}
      <line
        x1={pad}
        y1={redZoneY}
        x2={width - pad}
        y2={redZoneY}
        stroke="rgba(239,68,68,0.35)"
        strokeWidth={0.75}
        strokeDasharray="2 2"
      />

      {/* Sparkline */}
      <polyline
        points={polylinePoints}
        fill="none"
        stroke={overThreshold ? '#f87171' : color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Dot at the latest reading */}
      <circle
        cx={lastX}
        cy={lastY}
        r={2}
        fill={overThreshold ? '#f87171' : color}
      />
    </svg>
  );
}
