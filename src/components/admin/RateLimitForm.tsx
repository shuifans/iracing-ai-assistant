'use client';

import { useReducer } from 'react';

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

interface FormState {
  perMinuteLimit: number;
  perDayLimit: number;
  maxSessionTurns: number;
  enabled: boolean;
  errors: FieldErrors;
}

type FormAction =
  | { type: 'setPerMinuteLimit'; value: number }
  | { type: 'setPerDayLimit'; value: number }
  | { type: 'setMaxSessionTurns'; value: number }
  | { type: 'setEnabled'; value: boolean }
  | { type: 'setErrors'; value: FieldErrors };

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'setPerMinuteLimit':
      return { ...state, perMinuteLimit: action.value };
    case 'setPerDayLimit':
      return { ...state, perDayLimit: action.value };
    case 'setMaxSessionTurns':
      return { ...state, maxSessionTurns: action.value };
    case 'setEnabled':
      return { ...state, enabled: action.value };
    case 'setErrors':
      return { ...state, errors: action.value };
    default:
      return state;
  }
}

export function RateLimitForm({ initial, onSave, onCancel, saving }: RateLimitFormProps) {
  const [state, dispatch] = useReducer(formReducer, {
    perMinuteLimit: initial.perMinuteLimit,
    perDayLimit: initial.perDayLimit,
    maxSessionTurns: initial.maxSessionTurns,
    enabled: initial.enabled,
    errors: {},
  });

  const { perMinuteLimit, perDayLimit, maxSessionTurns, enabled, errors } = state;

  function validate(): boolean {
    const next: FieldErrors = {
      perMinuteLimit: validatePositiveInt(perMinuteLimit, '每分钟限制'),
      perDayLimit: validatePositiveInt(perDayLimit, '每日限制'),
      maxSessionTurns: validatePositiveInt(maxSessionTurns, '最大会话轮数'),
    };
    dispatch({ type: 'setErrors', value: next });
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
    <form onSubmit={handleSubmit} className="space-y-5 rounded-card border border-gray-200 bg-white shadow-card p-6">
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
          onChange={(e) => dispatch({ type: 'setPerMinuteLimit', value: parseInt(e.target.value, 10) || 0 })}
          className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/40 ${
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
          onChange={(e) => dispatch({ type: 'setPerDayLimit', value: parseInt(e.target.value, 10) || 0 })}
          className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/40 ${
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
          onChange={(e) => dispatch({ type: 'setMaxSessionTurns', value: parseInt(e.target.value, 10) || 0 })}
          className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/40 ${
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
          onClick={() => dispatch({ type: 'setEnabled', value: !enabled })}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/40 ${
            enabled ? 'bg-brand-600' : 'bg-gray-300'
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
          className="flex min-h-[40px] items-center rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-60"
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
