'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch, getAccessToken } from '@/lib/auth-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PipelineTiming {
  authMs: number;
  loadAgentContextMs: number;
  agentConnectMs: number;
  agentFirstByteMs: number;
  agentStreamMs: number;
  saveMessageMs: number;
  totalMs: number;
}

interface RoundResult {
  round: number;
  question: string;
  status: 'pending' | 'running' | 'success' | 'error';
  error?: string;
  timing?: PipelineTiming;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  responseLength?: number;
  sourceCount?: number;
  responseText?: string;
  // Client-side timing
  clientFirstByteMs?: number;
  clientTotalMs?: number;
}

interface DiagnosticSummary {
  totalRounds: number;
  successCount: number;
  failCount: number;
  avgFirstByteMs: number;
  avgTotalMs: number;
  maxTotalMs: number;
  minTotalMs: number;
  totalTokens: number;
  // Degradation analysis
  firstHalfAvgMs: number;
  secondHalfAvgMs: number;
  degradationPercent: number;
}

// ---------------------------------------------------------------------------
// Default test questions
// ---------------------------------------------------------------------------

const DEFAULT_QUESTIONS = [
  '如何调整赛车刹车平衡以获得更好的入弯表现？',
  '轮胎压力对圈速有什么影响？应该如何调整？',
  'iRacing 的安全等级（Safety Rating）是如何计算的？',
  '新手入门 iRacing 应该选择什么级别的赛车和赛道？',
  '如何在 Spa 赛道跑好 Eau Rouge 弯道？',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMs(ms: number | undefined): string {
  if (ms === undefined || ms === 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function timingColor(ms: number | undefined, good: number, warn: number): string {
  if (ms === undefined) return 'text-gray-400';
  if (ms <= good) return 'text-green-600';
  if (ms <= warn) return 'text-yellow-600';
  return 'text-red-600';
}

function statusBadge(status: string) {
  switch (status) {
    case 'success':
      return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">✓ 成功</span>;
    case 'error':
      return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">✗ 失败</span>;
    case 'running':
      return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 animate-pulse">● 运行中</span>;
    default:
      return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">○ 等待</span>;
  }
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function DiagnosticPage() {
  const router = useRouter();
  const [questions, setQuestions] = useState<string[]>(DEFAULT_QUESTIONS);
  const [editingQuestions, setEditingQuestions] = useState(false);
  const [editText, setEditText] = useState(DEFAULT_QUESTIONS.join('\n'));
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [summary, setSummary] = useState<DiagnosticSummary | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expandedRound, setExpandedRound] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Run a single round by streaming SSE from /api/chat/messages
  const runRound = useCallback(
    async (
      sid: string,
      roundNum: number,
      question: string,
    ): Promise<RoundResult> => {
      const roundStart = performance.now();
      const result: RoundResult = {
        round: roundNum,
        question,
        status: 'running',
      };

      const abortController = new AbortController();
      abortRef.current = abortController;

      try {
        const token = getAccessToken();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch('/api/chat/messages', {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({ sessionId: sid, content: question }),
          signal: abortController.signal,
        });

        if (!res.ok || !res.body) {
          let errorMsg = '请求失败';
          try {
            const json = await res.json();
            errorMsg = (json as any).error?.message ?? errorMsg;
          } catch { /* ignore */ }
          result.status = 'error';
          result.error = `${errorMsg} (HTTP ${res.status})`;
          result.clientTotalMs = Math.round(performance.now() - roundStart);
          return result;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentEventType = '';
        let accumulatedText = '';
        let sourceCount = 0;
        let firstByteTime: number | undefined;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (firstByteTime === undefined) {
            firstByteTime = performance.now() - roundStart;
            result.clientFirstByteMs = Math.round(firstByteTime);
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));

                if (currentEventType === 'delta' && data.text) {
                  accumulatedText += data.text;
                }

                if (currentEventType === 'source') {
                  sourceCount++;
                }

                if (currentEventType === 'usage') {
                  result.inputTokens = data.inputTokens;
                  result.outputTokens = data.outputTokens;
                  result.durationMs = data.durationMs;
                  if (data.timing) {
                    result.timing = data.timing as PipelineTiming;
                  }
                }

                if (currentEventType === 'done') {
                  if (data.timing) {
                    result.timing = data.timing as PipelineTiming;
                  }
                }

                if (currentEventType === 'error') {
                  result.status = 'error';
                  result.error = data.message;
                }
              } catch { /* skip */ }
            }
          }
        }

        if (result.status !== 'error') {
          result.status = accumulatedText.length > 0 ? 'success' : 'error';
          if (!accumulatedText.length) {
            result.error = '收到空响应';
          }
        }

        result.responseText = accumulatedText;
        result.responseLength = accumulatedText.length;
        result.sourceCount = sourceCount;
        result.clientTotalMs = Math.round(performance.now() - roundStart);
        if (!result.durationMs) {
          result.durationMs = result.clientTotalMs;
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          result.status = 'error';
          result.error = '测试已中止';
        } else {
          result.status = 'error';
          result.error = (err as Error).message;
        }
        result.clientTotalMs = Math.round(performance.now() - roundStart);
      }

      return result;
    },
    [],
  );

  // Run the full diagnostic suite
  async function runDiagnostic() {
    setRunning(true);
    setResults([]);
    setSummary(null);
    setSessionId(null);

    try {
      // 1. Create a new session
      const sessionRes = await authFetch('/api/chat/sessions', { method: 'POST' });
      if (!sessionRes.ok) {
        throw new Error('创建会话失败: HTTP ' + sessionRes.status);
      }
      const sessionJson = (await sessionRes.json()) as { data: { id: string } };
      const sid = sessionJson.data.id;
      setSessionId(sid);

      // 2. Run each question sequentially
      const allResults: RoundResult[] = [];
      for (let i = 0; i < questions.length; i++) {
        // Update status: current round running, others pending
        const pendingResults = questions.map((q, idx) => ({
          round: idx + 1,
          question: q,
          status: (idx < i ? 'success' : idx === i ? 'running' : 'pending') as RoundResult['status'],
          ...(idx < i ? allResults[idx] : {}),
        }));
        setResults(pendingResults);

        const result = await runRound(sid, i + 1, questions[i]!);
        allResults.push(result);

        // Update with this round's result
        setResults([...allResults, ...questions.slice(i + 1).map((q, idx) => ({
          round: i + 2 + idx,
          question: q,
          status: 'pending' as const,
        }))]);
      }

      // 3. Build summary
      const successful = allResults.filter((r) => r.status === 'success');
      const totalTimes = successful.map(
        (r) => r.timing?.totalMs ?? r.clientTotalMs ?? 0,
      );
      const firstByteTimes = successful.map(
        (r) => r.timing?.agentFirstByteMs ?? r.clientFirstByteMs ?? 0,
      );

      const half = Math.ceil(successful.length / 2);
      const firstHalf = totalTimes.slice(0, half);
      const secondHalf = totalTimes.slice(half);
      const firstHalfAvg = firstHalf.length
        ? firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length
        : 0;
      const secondHalfAvg = secondHalf.length
        ? secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length
        : 0;

      setSummary({
        totalRounds: allResults.length,
        successCount: successful.length,
        failCount: allResults.length - successful.length,
        avgFirstByteMs: Math.round(
          firstByteTimes.length
            ? firstByteTimes.reduce((a, b) => a + b, 0) / firstByteTimes.length
            : 0,
        ),
        avgTotalMs: Math.round(
          totalTimes.length
            ? totalTimes.reduce((a, b) => a + b, 0) / totalTimes.length
            : 0,
        ),
        maxTotalMs: Math.max(...totalTimes, 0),
        minTotalMs: Math.min(...totalTimes, 0),
        totalTokens: allResults.reduce(
          (sum, r) => sum + (r.inputTokens ?? 0) + (r.outputTokens ?? 0),
          0,
        ),
        firstHalfAvgMs: Math.round(firstHalfAvg),
        secondHalfAvgMs: Math.round(secondHalfAvg),
        degradationPercent: firstHalfAvg > 0
          ? Math.round(((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100)
          : 0,
      });
    } catch (err) {
      console.error('[Diagnostic] Failed:', err);
      setResults((prev) =>
        prev.map((r) =>
          r.status === 'running' || r.status === 'pending'
            ? { ...r, status: 'error', error: (err as Error).message }
            : r,
        ),
      );
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function stopDiagnostic() {
    abortRef.current?.abort();
    setRunning(false);
  }

  function saveQuestions() {
    const lines = editText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      setQuestions(lines);
    }
    setEditingQuestions(false);
  }

  function clearResults() {
    setResults([]);
    setSummary(null);
    setSessionId(null);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/chat')}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">多轮对话诊断测试</h1>
              <p className="mt-0.5 text-sm text-gray-500">
                测试多轮对话性能：追踪节点链路耗时、响应时长变化、错误率
              </p>
            </div>
          </div>
        </div>

        {/* Question Editor */}
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-700">测试问题 ({questions.length} 个)</h2>
            {!editingQuestions && !running && (
              <button
                onClick={() => { setEditText(questions.join('\n')); setEditingQuestions(true); }}
                className="text-xs text-blue-600 hover:text-blue-700"
              >
                编辑
              </button>
            )}
          </div>

          {editingQuestions ? (
            <div>
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={questions.length + 2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="每行一个问题"
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={saveQuestions}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  保存
                </button>
                <button
                  onClick={() => setEditingQuestions(false)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <ol className="space-y-1">
              {questions.map((q, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="flex-shrink-0 w-5 text-right text-xs text-gray-400">{i + 1}.</span>
                  <span>{q}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Action Buttons */}
        <div className="mb-6 flex gap-3">
          {!running ? (
            <>
              <button
                onClick={runDiagnostic}
                disabled={questions.length === 0}
                className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
              >
                🚀 开始诊断测试
              </button>
              {results.length > 0 && (
                <button
                  onClick={clearResults}
                  className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  清除结果
                </button>
              )}
            </>
          ) : (
            <button
              onClick={stopDiagnostic}
              className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-red-700"
            >
              ⏹ 停止测试
            </button>
          )}
          {sessionId && (
            <span className="flex items-center text-xs text-gray-400">
              Session: {sessionId.slice(0, 8)}…
            </span>
          )}
        </div>

        {/* Summary */}
        {summary && (
          <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="mb-4 text-sm font-semibold text-gray-700">📊 测试总结</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard label="成功率" value={`${summary.successCount}/${summary.totalRounds}`} color={summary.failCount > 0 ? 'red' : 'green'} />
              <StatCard label="平均首字节" value={formatMs(summary.avgFirstByteMs)} color={summary.avgFirstByteMs > 10000 ? 'red' : summary.avgFirstByteMs > 5000 ? 'yellow' : 'green'} />
              <StatCard label="平均总耗时" value={formatMs(summary.avgTotalMs)} color={summary.avgTotalMs > 60000 ? 'red' : summary.avgTotalMs > 30000 ? 'yellow' : 'green'} />
              <StatCard label="总 Token" value={summary.totalTokens.toLocaleString()} color="blue" />
            </div>

            {/* Timing breakdown */}
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <StatCard label="最快响应" value={formatMs(summary.minTotalMs)} color="green" />
              <StatCard label="最慢响应" value={formatMs(summary.maxTotalMs)} color="red" />
              <StatCard
                label="性能衰减"
                value={`${summary.degradationPercent >= 0 ? '+' : ''}${summary.degradationPercent}%`}
                subtitle={`前半段 ${formatMs(summary.firstHalfAvgMs)} → 后半段 ${formatMs(summary.secondHalfAvgMs)}`}
                color={summary.degradationPercent > 30 ? 'red' : summary.degradationPercent > 10 ? 'yellow' : 'green'}
              />
            </div>
          </div>
        )}

        {/* Results Table */}
        {results.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-700">📋 逐轮结果</h2>
            </div>

            {/* Table Header */}
            <div className="grid grid-cols-[40px_1fr_80px_90px_90px_80px_80px_60px] gap-2 border-b border-gray-100 px-4 py-2 text-xs font-medium text-gray-500">
              <span>#</span>
              <span>问题</span>
              <span className="text-right">状态</span>
              <span className="text-right">首字节</span>
              <span className="text-right">总耗时</span>
              <span className="text-right">Agent流</span>
              <span className="text-right">Token</span>
              <span className="text-right">来源</span>
            </div>

            {results.map((r) => (
              <div key={r.round}>
                {/* Row */}
                <div
                  className={`grid cursor-pointer grid-cols-[40px_1fr_80px_90px_90px_80px_80px_60px] items-center gap-2 border-b border-gray-50 px-4 py-3 text-sm hover:bg-gray-50 ${
                    r.status === 'error' ? 'bg-red-50/50' : ''
                  }`}
                  onClick={() => setExpandedRound(expandedRound === r.round ? null : r.round)}
                >
                  <span className="text-xs font-medium text-gray-400">{r.round}</span>
                  <span className="truncate text-gray-700">{r.question}</span>
                  <span className="text-right">{statusBadge(r.status)}</span>
                  <span className={`text-right font-mono text-xs ${timingColor(r.timing?.agentFirstByteMs ?? r.clientFirstByteMs, 5000, 15000)}`}>
                    {formatMs(r.timing?.agentFirstByteMs ?? r.clientFirstByteMs)}
                  </span>
                  <span className={`text-right font-mono text-xs ${timingColor(r.timing?.totalMs ?? r.clientTotalMs, 30000, 60000)}`}>
                    {formatMs(r.timing?.totalMs ?? r.clientTotalMs)}
                  </span>
                  <span className="text-right font-mono text-xs text-gray-500">
                    {formatMs(r.timing?.agentStreamMs)}
                  </span>
                  <span className="text-right text-xs text-gray-500">
                    {(r.inputTokens ?? 0) + (r.outputTokens ?? 0) > 0
                      ? `${((r.inputTokens ?? 0) + (r.outputTokens ?? 0)).toLocaleString()}`
                      : '-'}
                  </span>
                  <span className="text-right text-xs text-gray-500">{r.sourceCount ?? '-'}</span>
                </div>

                {/* Expanded Detail */}
                {expandedRound === r.round && (
                  <div className="border-b border-gray-100 bg-gray-50 px-4 py-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {/* Timing Waterfall */}
                      {r.timing && (
                        <div>
                          <h3 className="mb-2 text-xs font-semibold text-gray-600">⏱ 链路耗时分解</h3>
                          <TimingWaterfall timing={r.timing} />
                        </div>
                      )}

                      {/* Error / Response */}
                      <div>
                        {r.error ? (
                          <div>
                            <h3 className="mb-2 text-xs font-semibold text-red-600">❌ 错误信息</h3>
                            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                              {r.error}
                            </div>
                          </div>
                        ) : r.responseText ? (
                          <div>
                            <h3 className="mb-2 text-xs font-semibold text-gray-600">💬 响应内容</h3>
                            <div className="max-h-48 overflow-y-auto rounded-lg bg-white px-3 py-2 text-sm text-gray-600">
                              {r.responseText.slice(0, 500)}
                              {r.responseText.length > 500 && '…'}
                            </div>
                          </div>
                        ) : null}

                        {/* Client vs Server timing comparison */}
                        {r.clientTotalMs && r.timing && (
                          <div className="mt-3">
                            <h3 className="mb-2 text-xs font-semibold text-gray-600">🔗 客户端 vs 服务端</h3>
                            <div className="space-y-1 text-xs">
                              <div className="flex justify-between">
                                <span className="text-gray-500">客户端总耗时</span>
                                <span className="font-mono text-gray-700">{formatMs(r.clientTotalMs)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500">服务端总耗时</span>
                                <span className="font-mono text-gray-700">{formatMs(r.timing.totalMs)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500">网络传输开销</span>
                                <span className="font-mono text-gray-700">{formatMs(r.clientTotalMs - r.timing.totalMs)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500">客户端首字节</span>
                                <span className="font-mono text-gray-700">{formatMs(r.clientFirstByteMs)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500">服务端首字节</span>
                                <span className="font-mono text-gray-700">{formatMs(r.timing.agentFirstByteMs)}</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Running indicator */}
        {running && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <p className="text-sm text-gray-500">正在创建会话…</p>
          </div>
        )}

        {/* Empty state */}
        {!running && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-lg text-gray-400">🔬</p>
            <p className="mt-2 text-sm font-medium text-gray-500">点击「开始诊断测试」运行多轮对话性能检测</p>
            <p className="mt-1 text-xs text-gray-400">
              将依次发送 {questions.length} 个问题，追踪每轮的链路耗时和响应质量
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  subtitle,
  color = 'gray',
}: {
  label: string;
  value: string;
  subtitle?: string;
  color?: 'green' | 'red' | 'yellow' | 'blue' | 'gray';
}) {
  const colorMap = {
    green: 'text-green-600',
    red: 'text-red-600',
    yellow: 'text-yellow-600',
    blue: 'text-blue-600',
    gray: 'text-gray-700',
  };

  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2.5">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold ${colorMap[color]}`}>{value}</div>
      {subtitle && <div className="mt-0.5 text-[10px] text-gray-400">{subtitle}</div>}
    </div>
  );
}

function TimingWaterfall({ timing }: { timing: PipelineTiming }) {
  const stages = [
    { label: '鉴权', ms: timing.authMs, color: 'bg-purple-400' },
    { label: '构建 Agent 上下文', ms: timing.loadAgentContextMs, color: 'bg-cyan-400' },
    { label: 'Agent 首字节', ms: timing.agentFirstByteMs, color: 'bg-orange-400' },
    { label: 'Agent 流式传输', ms: timing.agentStreamMs, color: 'bg-green-400' },
    { label: '保存消息', ms: timing.saveMessageMs, color: 'bg-indigo-400' },
  ];

  const maxMs = Math.max(...stages.map((s) => s.ms), 1);

  return (
    <div className="space-y-1.5">
      {stages.map((stage) => (
        <div key={stage.label} className="flex items-center gap-2">
          <span className="w-28 flex-shrink-0 text-right text-[11px] text-gray-500">
            {stage.label}
          </span>
          <div className="flex-1">
            <div className="h-4 rounded bg-gray-100">
              <div
                className={`h-4 rounded ${stage.color} transition-all`}
                style={{ width: `${Math.max((stage.ms / maxMs) * 100, 2)}%` }}
              />
            </div>
          </div>
          <span className="w-16 flex-shrink-0 text-right font-mono text-[11px] text-gray-600">
            {formatMs(stage.ms)}
          </span>
        </div>
      ))}
      <div className="mt-2 flex items-center gap-2 border-t border-gray-200 pt-2">
        <span className="w-28 flex-shrink-0 text-right text-[11px] font-semibold text-gray-700">
          总计
        </span>
        <div className="flex-1" />
        <span className="w-16 flex-shrink-0 text-right font-mono text-[11px] font-semibold text-gray-700">
          {formatMs(timing.totalMs)}
        </span>
      </div>
    </div>
  );
}
