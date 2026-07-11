'use client';

import { useState } from 'react';
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

export default function ChatPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  async function createAndSend(content: string, attachmentIds: string[]) {
    if (creating) return;
    setCreating(true);

    try {
      // 创建新会话
      const sessionRes = await authFetch('/api/chat/sessions', { method: 'POST' });
      if (!sessionRes.ok) {
        setCreating(false);
        return;
      }
      const sessionJson = (await sessionRes.json()) as { data: { id: string } };
      const sessionId = sessionJson.data.id;

      // 将首条消息存入 sessionStorage，由 [sessionId] 页面发送
      sessionStorage.setItem(
        `pending-message-${sessionId}`,
        JSON.stringify({ content, attachmentIds }),
      );

      router.push(`/chat/${sessionId}`);
    } catch {
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
        <div className="w-full max-w-2xl">
          {/* 标题 */}
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">iRacing AI 助手</h1>
            <p className="mt-2 text-sm text-gray-500 sm:text-base">
              面向 iRacing 玩家的智能问答助手，问我任何关于赛车调校、驾驶技巧和赛事规则的问题
            </p>
          </div>

          {/* 推荐问题 */}
          <div className="mb-8">
            <h2 className="mb-3 text-sm font-medium text-gray-600">试试这些问题</h2>
            <div className="space-y-2">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => handleSuggestedQuestion(q)}
                  disabled={creating}
                  className="flex min-h-[44px] w-full items-center rounded-xl border border-gray-200 bg-white px-4 py-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50"
                >
                  <span className="mr-2 flex-shrink-0 text-blue-500">💡</span>
                  <span>{q}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 底部输入框 */}
      <div className="mx-auto w-full max-w-2xl px-3 sm:px-0">
        <ChatInput
          sessionId=""
          disabled={creating}
          isStreaming={false}
          onSendMessage={createAndSend}
          onStop={() => {}}
        />
      </div>
    </div>
  );
}
