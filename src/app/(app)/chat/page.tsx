'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth-client';
import { ChatInput } from '@/components/chat/ChatInput';

const SUGGESTED_QUESTIONS = [
  '如何调整赛车刹车平衡以获得更好的入弯表现？',
  '新手入门 iRacing 应该选择什么级别的赛车和赛道？',
  '如何在 Spa 赛道跑好 Eau Rouge 弯道？',
  '轮胎压力对圈速有什么影响？应该如何调整？',
  'iRacing 的安全等级（Safety Rating）是如何计算的？',
];

interface CreatedSessionState {
  id: string;
  webSearchEnabled: boolean;
  webStateUncertain: boolean;
}

export default function ChatPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const creatingRef = useRef(false);
  const createdSessionRef = useRef<CreatedSessionState | null>(null);

  async function createAndSend(content: string, attachmentIds: string[]) {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setError(null);

    try {
      const desiredWebSearchEnabled = webSearchEnabled;
      let session = createdSessionRef.current;

      if (!session) {
        const sessionRes = await authFetch('/api/chat/sessions', { method: 'POST' });
        if (!sessionRes.ok) {
          throw new Error(await readResponseError(sessionRes, '创建会话失败'));
        }
        const sessionJson = (await sessionRes.json()) as { data?: { id?: unknown } };
        if (typeof sessionJson.data?.id !== 'string' || sessionJson.data.id.length === 0) {
          throw new Error('创建会话失败');
        }
        session = {
          id: sessionJson.data.id,
          webSearchEnabled: false,
          webStateUncertain: false,
        };
        createdSessionRef.current = session;
      }

      if (session.webStateUncertain || session.webSearchEnabled !== desiredWebSearchEnabled) {
        session.webStateUncertain = true;
        const webResponse = await authFetch(`/api/chat/sessions/${session.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ webSearchEnabled: desiredWebSearchEnabled }),
        });
        await validateWebSearchResponse(webResponse, session.id, desiredWebSearchEnabled);
        session.webSearchEnabled = desiredWebSearchEnabled;
        session.webStateUncertain = false;
      }

      // 将首条消息存入 sessionStorage，由 [sessionId] 页面发送
      sessionStorage.setItem(
        `pending-message-${session.id}`,
        JSON.stringify({ content, attachmentIds }),
      );

      router.push(`/chat/${session.id}`);
      createdSessionRef.current = null;
    } catch (createError) {
      setError((createError as Error).message || '创建会话失败');
      creatingRef.current = false;
      setCreating(false);
    }
  }

  async function handleSuggestedQuestion(question: string) {
    await createAndSend(question, []);
  }

  return (
    <div className="flex h-full flex-col">
      {/* 主内容区 */}
      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8">
        <div className="w-full max-w-3xl">
          {/* 标题 */}
          <div className="mb-7 text-center">
            <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">iRacing AI 助手</h1>
            <p className="mt-2 text-[13px] leading-5 text-gray-500 sm:text-sm">
              面向 iRacing 玩家的智能问答助手，问我任何关于赛车调校、驾驶技巧和赛事规则的问题
            </p>
          </div>

          {/* 推荐问题 */}
          <div className="mb-7">
            <h2 className="mb-2.5 text-[13px] font-medium text-gray-600 sm:text-sm">
              试试这些问题
            </h2>
            <div className="space-y-1.5">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => handleSuggestedQuestion(q)}
                  disabled={creating}
                  className="flex min-h-[44px] w-full items-center rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-left text-[13px] leading-5 text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50 sm:text-sm"
                >
                  <span className="mr-2 flex-shrink-0 text-blue-500">💡</span>
                  <span>{q}</span>
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* 底部输入框 */}
      <div className="mx-auto w-full max-w-3xl px-3 sm:px-4">
        <ChatInput
          sessionId=""
          disabled={creating}
          isStreaming={false}
          onSendMessage={createAndSend}
          onStop={() => {}}
          webSearchEnabled={webSearchEnabled}
          onWebSearchChange={(enabled) => {
            setWebSearchEnabled(enabled);
            setError(null);
          }}
          webSearchUpdating={creating && webSearchEnabled}
        />
      </div>
    </div>
  );
}

async function readResponseError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: string } };
    return payload.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

async function validateWebSearchResponse(
  response: Response,
  sessionId: string,
  expectedEnabled: boolean,
): Promise<void> {
  if (!response.ok) {
    throw new Error(await readResponseError(response, '保存联网搜索设置失败'));
  }

  try {
    const payload = (await response.json()) as {
      data?: { id?: unknown; webSearchEnabled?: unknown };
    };
    if (payload.data?.id !== sessionId || payload.data.webSearchEnabled !== expectedEnabled) {
      throw new Error('INVALID_WEB_SEARCH_RESPONSE');
    }
  } catch {
    throw new Error('保存联网搜索设置失败');
  }
}
