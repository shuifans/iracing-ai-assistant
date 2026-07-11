'use client';

import { useState, useEffect } from 'react';

interface RateLimitFormProps {
  initial: {
    id: string;
    perMinuteLimit: number;
    perDayLimit: number;
    maxSessionTurns: number;
    enabled: boolean;
  };
  onSave: (data: {
    id: string;
    perMinuteLimit: number;
    perDayLimit: number;
    maxSessionTurns: number;
    enabled: boolean;
  }) => Promise<void>;
  onCancel: () => void;
  saving?: boolean;
}

interface FieldErrors {
  perMinuteLimit?: string;
  perDayLimit?: string;
  maxSessionTurns?: string;
}

function validatePositiveInt(value: number, label: string): string | undefined {
  if (!Number.isInteger(value) || value <= 0) {
    return `${label} 必须为正整数`;
  }
  return undefined;
}

export function RateLimitForm({ initial, onSave, onCancel, saving }: RateLimitFormProps) {
  const [perMinuteLimit, setPerMinuteLimit] = useState(initial.perMinuteLimit);
  const [perDayLimit, setPerDayLimit] = useState(initial.perDayLimit);
  const [maxSessionTurns, setMaxSessionTurns] = useState(initial.maxSessionTurns);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    setPerMinuteLimit(initial.perMinuteLimit);
    setPerDayLimit(initial.perDayLimit);
    setMaxSessionTurns(initial.maxSessionTurns);
    setEnabled(initial.enabled);
    setErrors({});
  }, [initial]);

  function validate(): boolean {
    const next: FieldErrors = {
      perMinuteLimit: validatePositiveInt(perMinuteLimit, '每分钟限制'),
      perDayLimit: validatePositiveInt(perDayLimit, '每日限制'),
      maxSessionTurns: validatePositiveInt(maxSessionTurns, '最大会话轮数'),
    };
    setErrors(next);
    return !next.perMinuteLimit && !next.perDayLimit && !next.maxSessionTurns;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    await onSave({
      id: initial.id,
      perMinuteLimit,
      perDayLimit,
      maxSessionTurns,
      enabled,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-gray-200 bg-white p-6">
      <h3 className="text-base font-semibold text-gray-800">编辑限流配置</h3>

      {/* 每分钟限制 */}
      <div>
        <label htmlFor="perMinuteLimit" className="mb-1 block text-sm font-medium text-gray-700">
          每分钟限制
        </label>
        <input
          id="perMinuteLimit"
          type="number"
          min={1}
          step={1}
          value={perMinuteLimit}
          onChange={(e) => setPerMinuteLimit(parseInt(e.target.value, 10) || 0)}
          className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
            errors.perMinuteLimit ? 'border-red-400' : 'border-gray-300'
          }`}
        />
        {errors.perMinuteLimit && (
          <p className="mt-1 text-xs text-red-500">{errors.perMinuteLimit}</p>
        )}
      </div>

      {/* 每日限制 */}
      <div>
        <label htmlFor="perDayLimit" className="mb-1 block text-sm font-medium text-gray-700">
          每日限制
        </label>
        <input
          id="perDayLimit"
          type="number"
          min={1}
          step={1}
          value={perDayLimit}
          onChange={(e) => setPerDayLimit(parseInt(e.target.value, 10) || 0)}
          className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
            errors.perDayLimit ? 'border-red-400' : 'border-gray-300'
          }`}
        />
        {errors.perDayLimit && (
          <p className="mt-1 text-xs text-red-500">{errors.perDayLimit}</p>
        )}
      </div>

      {/* 最大会话轮数 */}
      <div>
        <label htmlFor="maxSessionTurns" className="mb-1 block text-sm font-medium text-gray-700">
          最大会话轮数
        </label>
        <input
          id="maxSessionTurns"
          type="number"
          min={1}
          step={1}
          value={maxSessionTurns}
          onChange={(e) => setMaxSessionTurns(parseInt(e.target.value, 10) || 0)}
          className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
            errors.maxSessionTurns ? 'border-red-400' : 'border-gray-300'
          }`}
        />
        {errors.maxSessionTurns && (
          <p className="mt-1 text-xs text-red-500">{errors.maxSessionTurns}</p>
        )}
      </div>

      {/* 启用开关 */}
      <div className="flex items-center gap-3">
        <label htmlFor="enabled" className="text-sm font-medium text-gray-700">
          启用限流
        </label>
        <button
          id="enabled"
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled((v) => !v)}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
            enabled ? 'bg-blue-600' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
        <span className="text-sm text-gray-500">{enabled ? '已启用' : '已禁用'}</span>
      </div>

      {/* 按钮组 */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="flex min-h-[40px] items-center rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex min-h-[40px] items-center rounded-lg border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          取消
        </button>
      </div>
    </form>
  );
}
