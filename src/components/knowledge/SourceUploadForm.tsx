'use client';

import { useState, useCallback, useRef } from 'react';
import { authFetch } from '@/lib/auth-client';

interface SourceUploadFormProps {
  onSuccess?: () => void;
  onError?: (message: string) => void;
}

export function SourceUploadForm({ onSuccess, onError }: SourceUploadFormProps) {
  const [activeTab, setActiveTab] = useState<'file' | 'url'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  }, []);

  const submitFile = async () => {
    if (!file) return;
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await authFetch('/api/knowledge/sources/file', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message?: string } };
        throw new Error(json.error?.message ?? '上传失败');
      }
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onSuccess?.();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : '上传失败');
    } finally {
      setSubmitting(false);
    }
  };

  const submitUrl = async () => {
    if (!url.trim()) return;
    setSubmitting(true);
    try {
      const res = await authFetch('/api/knowledge/sources/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), title: title.trim() || undefined }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message?: string } };
        throw new Error(json.error?.message ?? '提交失败');
      }
      setUrl('');
      setTitle('');
      onSuccess?.();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="mb-4 flex gap-4 border-b border-gray-200">
        <button
          type="button"
          onClick={() => setActiveTab('file')}
          className={`inline-flex min-h-[44px] items-center border-b-2 px-1 py-2 text-sm font-medium transition-colors ${
            activeTab === 'file'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          文件上传
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('url')}
          className={`inline-flex min-h-[44px] items-center border-b-2 px-1 py-2 text-sm font-medium transition-colors ${
            activeTab === 'url'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          URL 提交
        </button>
      </div>

      {activeTab === 'file' ? (
        <div className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
              dragOver
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-300 bg-gray-50 hover:border-gray-400'
            }`}
          >
            <svg
              className="mb-3 h-10 w-10 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p className="text-sm text-gray-600">
              {file ? file.name : '拖拽文件到此处，或点击选择文件'}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              支持 .txt, .md, .docx, .pdf, .xlsx, .xls
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.docx,.pdf,.xlsx,.xls"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          <button
            type="button"
            onClick={submitFile}
            disabled={!file || submitting}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? '上传中…' : '上传文件'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label htmlFor="source-url" className="mb-1 block text-sm font-medium text-gray-700">
              URL <span className="text-red-500">*</span>
            </label>
            <input
              id="source-url"
              type="url"
              placeholder="https://example.com/article"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="source-title" className="mb-1 block text-sm font-medium text-gray-700">
              标题（可选）
            </label>
            <input
              id="source-title"
              type="text"
              placeholder="来源标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            type="button"
            onClick={submitUrl}
            disabled={!url.trim() || submitting}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? '提交中…' : '提交 URL'}
          </button>
        </div>
      )}
    </div>
  );
}
