import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Toast } from '@/components/common/Toast';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Toast', () => {
  it('renders message', () => {
    render(<Toast message="Success!" type="success" onClose={() => {}} />);
    expect(screen.getByText('Success!')).toBeTruthy();
  });

  it('has alert role', () => {
    const { container } = render(<Toast message="Error" type="error" onClose={() => {}} />);
    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
  });

  it('applies success color', () => {
    const { container } = render(<Toast message="OK" type="success" onClose={() => {}} />);
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.className).toContain('bg-green-600');
  });

  it('applies error color', () => {
    const { container } = render(<Toast message="Err" type="error" onClose={() => {}} />);
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.className).toContain('bg-red-600');
  });

  it('applies info color', () => {
    const { container } = render(<Toast message="Info" type="info" onClose={() => {}} />);
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.className).toContain('bg-blue-600');
  });

  it('calls onClose after 3 seconds', () => {
    const onClose = vi.fn();
    render(<Toast message="Test" type="info" onClose={onClose} />);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<Toast message="Test" type="info" onClose={onClose} />);
    const closeBtn = container.querySelector('button[aria-label="关闭通知"]');
    fireEvent.click(closeBtn!);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders close button', () => {
    const { container } = render(<Toast message="Test" type="info" onClose={() => {}} />);
    const closeBtn = container.querySelector('button[aria-label="关闭通知"]');
    expect(closeBtn).toBeTruthy();
  });
});
