'use client';

import { useState, useRef, type KeyboardEvent, type FormEvent, type ChangeEvent } from 'react';
import { authFetch } from '@/lib/auth-client';

interface ChatInputProps {
  sessionId: string;
  disabled?: boolean;
  isStreaming?: boolean;
  onSendMessage: (content: string, attachmentIds: string[]) => void;
  onStop: () => void;
  webSearchEnabled: boolean;
  onWebSearchChange: (enabled: boolean) => void;
  webSearchUpdating?: boolean;
}

export function ChatInput({
  sessionId,
  disabled,
  isStreaming,
  onSendMessage,
  onStop,
  webSearchEnabled,
  onWebSearchChange,
  webSearchUpdating = false,
}: ChatInputProps) {
  const [content, setContent] = useState('');
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState<{ id: string; preview: string; name: string }[]>(
    [],
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSend = !disabled && !isStreaming && content.trim().length > 0;

  function autoResize() {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
    }
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value);
    autoResize();
  }

  async function handleImageUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (attachments.length + files.length > 4) {
      return;
    }

    setUploading(true);
    const newAttachments: typeof attachments = [];

    for (let i = 0; i < files.length; i++) {
      const file = files.item(i);
      if (!file) continue;
      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await authFetch('/api/uploads/images', {
          method: 'POST',
          body: formData,
        });
        if (res.ok) {
          const json = (await res.json()) as { data: { id: string } };
          const preview = URL.createObjectURL(file);
          newAttachments.push({ id: json.data.id, preview, name: file.name });
        }
      } catch {
        // 上传失败静默处理
      }
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
    setUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => {
      const next = [...prev];
      const item = next[index];
      if (item) {
        URL.revokeObjectURL(item.preview);
      }
      next.splice(index, 1);
      return next;
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    const text = content.trim();
    const attachmentIds = attachments.map((a) => a.id);
    setContent('');
    attachments.forEach((a) => URL.revokeObjectURL(a.preview));
    setAttachments([]);
    onSendMessage(text, attachmentIds);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  return (
    <div className="border-t border-gray-200/80 bg-gray-50/80 px-3 py-2 sm:px-4 sm:py-3">
      <div className="mb-2 flex items-start gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2">
        <button
          type="button"
          role="switch"
          aria-label="联网搜索"
          aria-checked={webSearchEnabled}
          disabled={disabled || webSearchUpdating}
          onClick={() => onWebSearchChange(!webSearchEnabled)}
          className={`relative mt-0.5 inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${
            webSearchEnabled ? 'bg-blue-600' : 'bg-gray-300'
          }`}
        >
          <span
            aria-hidden
            className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
              webSearchEnabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-700">
            联网搜索{webSearchUpdating ? '（保存中…）' : ''}
          </p>
          <p className="mt-0.5 text-xs leading-5 text-gray-500">
            优先使用本地知识库；仅本地资料不足时访问管理员授权的网站。联网回答可能需要最多约 2
            分钟。
          </p>
        </div>
      </div>

      {/* 图片预览区 */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((att, idx) => (
            <div key={att.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- blob URL preview, cannot use next/image */}
              <img src={att.preview} alt={att.name} className="h-14 w-14 rounded-lg object-cover" />
              <button
                type="button"
                onClick={() => removeAttachment(idx)}
                className="absolute -right-2 -top-2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-white"
                aria-label="移除图片"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-xs">
                  ×
                </span>
              </button>
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-1.5 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-sm"
      >
        {/* 图片上传按钮 */}
        <label
          className={`flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 ${
            uploading ? 'opacity-50' : ''
          }`}
          aria-label="上传图片"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            onChange={(e) => handleImageUpload(e.target.files)}
            disabled={uploading || disabled}
          />
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </label>

        {/* 文本输入框 */}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="输入您的问题…"
          disabled={disabled}
          rows={1}
          className="max-h-[120px] min-h-[42px] flex-1 resize-none rounded-2xl border-0 bg-transparent px-3.5 py-2 text-[14px] leading-5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0 disabled:opacity-50"
          aria-label="消息输入"
        />

        {/* 发送 / 停止按钮 */}
        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-red-500 text-white transition-colors hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500/40"
            aria-label="停止生成"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-blue-600 text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="发送消息"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>
        )}
      </form>
    </div>
  );
}
