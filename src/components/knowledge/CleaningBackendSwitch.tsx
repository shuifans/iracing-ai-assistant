'use client';

/**
 * Cleaning-backend switch — password-gated.
 *
 * Shows the current knowledge-cleaning backend (LongCat LLM-direct | Qoder
 * SDK) and a "切换" button that opens a modal. Switching requires a password
 * verified server-side against `MODEL_SWITCH_PASSWORD_HASH`. The badge is
 * visible to all knowledge_admin/admin; only the super-admin who knows the
 * password can actually switch (others land on the default LongCat path).
 *
 * @module components/knowledge/CleaningBackendSwitch
 */

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth-client';

type Backend = 'llm-direct' | 'qoder-sdk';

const BACKEND_LABELS: Record<Backend, string> = {
  'llm-direct': 'LongCat（LLM 直连）',
  'qoder-sdk': 'Qwen3.7-Plus（Qoder SDK）',
};

interface CleaningBackendSwitchProps {
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
}

export function CleaningBackendSwitch({ onSuccess, onError }: CleaningBackendSwitchProps) {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<Backend>('llm-direct');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch('/api/knowledge/cleaning-backend');
      if (res.ok) {
        const json = (await res.json()) as { data: { backend: Backend } };
        setBackend(json.data.backend);
      }
    } catch {
      // silent — the badge just stays empty
    }
  }, []);

  useEffect(() => {
    // Fetch the current backend on mount. State is updated after the request resolves.
    void refresh();
  }, [refresh]);

  function openModal() {
    setSelected(backend ?? 'llm-direct');
    setPassword('');
    setModalOpen(true);
  }

  async function submit() {
    setSubmitting(true);
    try {
      const res = await authFetch('/api/knowledge/cleaning-backend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backend: selected, password }),
      });

      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        const msg = json?.error?.message ?? '切换失败';
        onError?.(msg);
        return;
      }

      await refresh();
      onSuccess?.(`清洗模型已切换为 ${BACKEND_LABELS[selected]}`);
      setModalOpen(false);
      setPassword('');
    } catch {
      onError?.('网络错误，切换失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {backend ? (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
          清洗模型：{BACKEND_LABELS[backend]}
        </span>
      ) : (
        <span className="text-xs text-gray-400">加载中…</span>
      )}
      <button
        type="button"
        onClick={openModal}
        className="inline-flex min-h-[36px] items-center rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
      >
        切换
      </button>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModalOpen(false)} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cleaning-backend-switch-title"
            className="relative z-10 w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
          >
            <h3 id="cleaning-backend-switch-title" className="text-lg font-semibold text-gray-900">
              切换清洗模型
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              切换对下一个清洗任务生效（worker 按任务读取）。需输入切换密码。
            </p>

            <div className="mt-4 space-y-2">
              {(Object.keys(BACKEND_LABELS) as Backend[]).map((b) => (
                <label
                  key={b}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-gray-50"
                  style={{ borderColor: selected === b ? '#2563eb' : '#e5e7eb' }}
                >
                  <input
                    type="radio"
                    name="cleaning-backend"
                    value={b}
                    checked={selected === b}
                    onChange={() => setSelected(b)}
                    className="h-4 w-4 accent-blue-600"
                  />
                  <span className="text-gray-900">{BACKEND_LABELS[b]}</span>
                </label>
              ))}
            </div>

            <div className="mt-4">
              <label htmlFor="cleaning-backend-password" className="block text-sm font-medium text-gray-700">
                切换密码
              </label>
              <input
                id="cleaning-backend-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                placeholder="••••••••"
              />
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={submitting}
                className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400/40 disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || !password}
                className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? '切换中…' : '确认切换'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
