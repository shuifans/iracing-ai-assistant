'use client';

import { useRef, useEffect, useState } from 'react';
import type { UsageTrend } from '@/modules/analytics/types';

interface UsageChartProps {
  data: UsageTrend[];
  loading?: boolean;
}

export function UsageChart({ data, loading = false }: UsageChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-white">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm text-gray-400">
        暂无使用量数据
      </div>
    );
  }

  const height = 220;
  const padTop = 20;
  const padRight = 20;
  const padBottom = 40;
  const padLeft = 50;
  const chartW = Math.max(width - padLeft - padRight, 1);
  const chartH = height - padTop - padBottom;

  const maxCalls = Math.max(...data.map((d) => d.calls), 1);
  const yTicks = 4;

  const points = data.map((d, i) => {
    const x = padLeft + (i / Math.max(data.length - 1, 1)) * chartW;
    const y = padTop + chartH - (d.calls / maxCalls) * chartH;
    return { x, y, ...d };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(' ');

  // Y-axis tick values
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) =>
    Math.round((maxCalls / yTicks) * i),
  );

  // X-axis labels: show at most 7 evenly-spaced labels
  const xLabelCount = Math.min(data.length, 7);
  const xLabelIndices = Array.from({ length: xLabelCount }, (_, i) =>
    Math.round((i / Math.max(xLabelCount - 1, 1)) * (data.length - 1)),
  );

  return (
    <div ref={containerRef} className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">使用量趋势</h3>
      <svg
        width={width - 32}
        height={height}
        viewBox={`0 0 ${width - 32} ${height}`}
        className="overflow-visible"
      >
        {/* Grid lines */}
        {yTickValues.map((val) => {
          const y = padTop + chartH - (val / maxCalls) * chartH;
          return (
            <g key={val}>
              <line
                x1={padLeft}
                y1={y}
                x2={padLeft + chartW}
                y2={y}
                stroke="#f3f4f6"
                strokeWidth={1}
              />
              <text
                x={padLeft - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-gray-400 text-[10px]"
              >
                {val}
              </text>
            </g>
          );
        })}

        {/* Polyline */}
        <polyline
          fill="none"
          stroke="#3b82f6"
          strokeWidth={2}
          strokeLinejoin="round"
          points={polyline}
        />

        {/* Data dots */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill="#3b82f6" />
        ))}

        {/* X-axis labels */}
        {xLabelIndices.map((idx) => {
          const p = points[idx];
          if (!p) return null;
          const label = p.date.length > 10 ? p.date.slice(5) : p.date;
          return (
            <text
              key={idx}
              x={p.x}
              y={height - 8}
              textAnchor="middle"
              className="fill-gray-400 text-[10px]"
            >
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
