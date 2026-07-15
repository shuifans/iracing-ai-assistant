import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/auth-client', () => ({ authFetch: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { authFetch } from '@/lib/auth-client';
import { WebSourceManager } from '@/components/knowledge/WebSourceManager';
import KnowledgePage from '@/app/(app)/knowledge/page';

afterEach(cleanup);

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('WebSourceManager', () => {
  beforeEach(() => {
    vi.mocked(authFetch).mockReset();
  });

  it('renders configured sources and can disable one', async () => {
    vi.mocked(authFetch)
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            sources: [
              {
                id: 's1',
                name: 'iRacing Support',
                scopeType: 'domain',
                url: 'https://support.iracing.com',
                sourceLevel: 'official',
                enabled: true,
                description: null,
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            source: {
              id: 's1',
              name: 'iRacing Support',
              scopeType: 'domain',
              url: 'https://support.iracing.com',
              sourceLevel: 'official',
              enabled: false,
              description: null,
            },
          },
        }),
      );

    render(<WebSourceManager />);

    expect(await screen.findByText('iRacing Support')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '停用 iRacing Support' }));

    await waitFor(() => {
      expect(authFetch).toHaveBeenCalledWith(
        '/api/knowledge/web-sources/s1',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
  });

  it('creates a source with every configurable field', async () => {
    vi.mocked(authFetch)
      .mockResolvedValueOnce(jsonResponse({ data: { sources: [] } }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              source: {
                id: 's2',
                name: 'Race Control',
                scopeType: 'path',
                url: 'https://support.iracing.com/race-control',
                sourceLevel: 'community',
                enabled: false,
                description: 'Stewarding notes',
              },
            },
          },
          { status: 201 },
        ),
      );

    render(<WebSourceManager />);
    await screen.findByText('暂无联网知识源');

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Race Control' } });
    fireEvent.change(screen.getByLabelText('范围类型'), { target: { value: 'path' } });
    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: 'https://support.iracing.com/race-control' },
    });
    fireEvent.change(screen.getByLabelText('来源级别'), { target: { value: 'community' } });
    fireEvent.click(screen.getByLabelText('启用状态'));
    fireEvent.change(screen.getByLabelText('说明'), { target: { value: 'Stewarding notes' } });
    fireEvent.click(screen.getByRole('button', { name: '创建 Race Control' }));

    await waitFor(() => {
      expect(authFetch).toHaveBeenCalledWith('/api/knowledge/web-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Race Control',
          scopeType: 'path',
          url: 'https://support.iracing.com/race-control',
          sourceLevel: 'community',
          enabled: false,
          description: 'Stewarding notes',
        }),
      });
    });
    expect(await screen.findByText('Race Control')).toBeTruthy();
  });

  it('shows backend validation errors', async () => {
    vi.mocked(authFetch)
      .mockResolvedValueOnce(jsonResponse({ data: { sources: [] } }))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'VALIDATION_ERROR', message: '知识源 URL 必须使用 HTTPS' } },
          { status: 400 },
        ),
      );

    render(<WebSourceManager />);
    await screen.findByText('暂无联网知识源');
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Unsafe source' } });
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'http://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '创建 Unsafe source' }));

    expect(await screen.findByText('知识源 URL 必须使用 HTTPS')).toBeTruthy();
  });

  it('edits a source and deletes it after confirmation', async () => {
    const source = {
      id: 's1',
      name: 'iRacing Support',
      scopeType: 'domain',
      url: 'https://support.iracing.com',
      sourceLevel: 'official',
      enabled: true,
      description: null,
    };
    vi.mocked(authFetch)
      .mockResolvedValueOnce(jsonResponse({ data: { sources: [source] } }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { source: { ...source, name: 'iRacing Help' } } }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { deleted: true } }));

    render(<WebSourceManager />);
    await screen.findByText('iRacing Support');

    fireEvent.click(screen.getByRole('button', { name: '编辑 iRacing Support' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'iRacing Help' } });
    fireEvent.click(screen.getByRole('button', { name: '保存 iRacing Help' }));

    expect(await screen.findByText('iRacing Help')).toBeTruthy();
    expect(authFetch).toHaveBeenCalledWith(
      '/api/knowledge/web-sources/s1',
      expect.objectContaining({ method: 'PATCH' }),
    );

    fireEvent.click(screen.getByRole('button', { name: '删除 iRacing Help' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => {
      expect(authFetch).toHaveBeenCalledWith('/api/knowledge/web-sources/s1', {
        method: 'DELETE',
      });
    });
    expect(await screen.findByText('暂无联网知识源')).toBeTruthy();
  });
});

describe('knowledge page web sources tab', () => {
  beforeEach(() => {
    vi.mocked(authFetch).mockReset();
  });

  it('renders the self-contained manager in its own tab', async () => {
    vi.mocked(authFetch)
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            stats: {
              items: { byStatus: [], byCategory: [], total: 0 },
              drafts: { byStatus: [], reviewQueue: 0, total: 0 },
              sources: { total: 0 },
              jobs: { byStatus: [] },
              reClean: { jobsTotal: 0, byVersion: [] },
              tierDistribution: [],
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { sources: [] } }));

    render(<KnowledgePage />);
    await waitFor(() => expect(authFetch).toHaveBeenCalledWith('/api/knowledge/stats'));
    fireEvent.click(screen.getByRole('tab', { name: '联网知识源' }));

    expect(await screen.findByRole('heading', { name: '新增联网知识源' })).toBeTruthy();
    expect(authFetch).toHaveBeenCalledWith('/api/knowledge/web-sources');
  });
});
