'use client';

// 导入知识工作流看板：导入 → 清洗 → 审查 → 通过，点击阶段过滤下方列表。
export type WorkflowStage = 'imported' | 'cleaning' | 'pendingReview' | 'approvedPending';

// 每个阶段对应的 job 状态集合（逗号分隔传给 /api/knowledge/jobs?status=）
export const STAGE_JOB_STATUSES: Record<WorkflowStage, string> = {
  imported: 'queued,paused,extracting',
  cleaning: 'cleaning',
  pendingReview: 'pending_review',
  approvedPending: 'approved',
};

interface WorkflowBoardProps {
  counts: {
    imported: number;
    cleaning: number;
    pendingReview: number;
    approvedPending: number;
  } | null;
  activeStage: WorkflowStage | null;
  onStageClick: (stage: WorkflowStage | null) => void;
}

const STAGES: { key: WorkflowStage; label: string; description: string }[] = [
  { key: 'imported', label: '① 导入', description: '排队 / 暂停 / 提取中' },
  { key: 'cleaning', label: '② 清洗中', description: 'LLM 清洗处理' },
  { key: 'pendingReview', label: '③ 待审查', description: '等待管理员审查' },
  { key: 'approvedPending', label: '④ 已通过', description: '待发布上线' },
];

export function WorkflowBoard({ counts, activeStage, onStageClick }: WorkflowBoardProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
      {STAGES.map((stage, i) => {
        const active = activeStage === stage.key;
        return (
          <div key={stage.key} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => onStageClick(active ? null : stage.key)}
              className={`w-full rounded-card border p-4 text-left transition-all focus:outline-none focus:ring-2 focus:ring-brand-500/40 ${
                active
                  ? 'border-brand-500 bg-brand-50 shadow-card'
                  : 'border-gray-200 bg-white hover:border-brand-300 hover:bg-brand-50/50 hover:shadow-card'
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span
                  className={`text-sm font-medium ${active ? 'text-brand-700' : 'text-gray-700'}`}
                >
                  {stage.label}
                </span>
                <span
                  className={`text-2xl font-semibold ${active ? 'text-brand-700' : 'text-gray-900'}`}
                >
                  {counts ? counts[stage.key] : '—'}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-500">{stage.description}</p>
            </button>
            {i < STAGES.length - 1 && (
              <span className="hidden shrink-0 text-gray-300 sm:block" aria-hidden>
                →
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
