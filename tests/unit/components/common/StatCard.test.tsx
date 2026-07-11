import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCard } from '@/components/common/StatCard';

describe('StatCard', () => {
  it('renders title and value', () => {
    render(<StatCard title="总用户" value={42} />);
    expect(screen.getByText('总用户')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('renders subtitle when provided', () => {
    render(<StatCard title="Users" value="100" subtitle="过去30天" />);
    expect(screen.getByText('过去30天')).toBeTruthy();
  });

  it('does not render subtitle when not provided', () => {
    const { container } = render(<StatCard title="Users" value={10} />);
    expect(container.querySelectorAll('p').length).toBe(2);
  });

  it('shows trend indicator when trend is provided', () => {
    const { container } = render(<StatCard title="Sales" value="500" trend="up" />);
    const trendSpan = container.querySelector('[data-trend]');
    expect(trendSpan).toBeTruthy();
  });

  it('applies green color for up trend', () => {
    const { container } = render(<StatCard title="Sales" value="500" trend="up" />);
    const trendSpan = container.querySelector('[data-trend="up"]');
    expect(trendSpan?.className).toContain('text-green-600');
  });

  it('applies red color for down trend', () => {
    const { container } = render(<StatCard title="Sales" value="200" trend="down" />);
    const trendSpan = container.querySelector('[data-trend="down"]');
    expect(trendSpan?.className).toContain('text-red-600');
  });

  it('applies gray color for neutral trend', () => {
    const { container } = render(<StatCard title="Sales" value="300" trend="neutral" />);
    const trendSpan = container.querySelector('[data-trend="neutral"]');
    expect(trendSpan?.className).toContain('text-gray-500');
  });
});
