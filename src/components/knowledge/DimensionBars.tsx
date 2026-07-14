'use client';

interface DimensionScoreView {
  dimensionKey: string;
  tier: string;
  score: number;
  weight: number;
  rationale?: string;
}

const DIM_LABEL: Record<string, string> = {
  front_matter_validity: 'Front Matter',
  content_length: '正文长度',
  tag_category_sanity: '标签/分类',
  dedup_overlap: '查重',
  freshness: '时效性',
  retrievability: '可检索性',
  accuracy: '准确性',
  completeness: '完整性',
  clarity: '清晰度',
};

export function DimensionBars({ dimensions }: { dimensions: DimensionScoreView[] }) {
  if (!dimensions.length) {
    return <p className="text-sm text-gray-500">暂无维度数据</p>;
  }
  return (
    <div className="space-y-2">
      {dimensions.map((d) => {
        const color =
          d.score >= 85 ? 'bg-green-500' : d.score >= 60 ? 'bg-yellow-500' : 'bg-red-500';
        return (
          <div key={d.dimensionKey} className="flex items-center gap-3">
            <span
              className="w-28 shrink-0 truncate text-xs text-gray-600"
              title={DIM_LABEL[d.dimensionKey] ?? d.dimensionKey}
            >
              {DIM_LABEL[d.dimensionKey] ?? d.dimensionKey}
            </span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
              <div
                className={`h-full rounded-full ${color} transition-all`}
                style={{ width: `${d.score}%` }}
              />
            </div>
            <span className="w-8 text-right text-xs font-medium text-gray-700">{d.score}</span>
            <span className="w-8 text-right text-xs text-gray-400">×{d.weight}</span>
          </div>
        );
      })}
    </div>
  );
}
