import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';

afterEach(cleanup);

describe('ConfirmDialog', () => {
  const defaultProps = {
    isOpen: true,
    title: 'Delete Confirm',
    message: 'Are you sure you want to delete this record?',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('renders nothing when isOpen is false', () => {
    render(<ConfirmDialog {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('Delete Confirm')).toBeNull();
  });

  it('renders title and message when open', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Delete Confirm')).toBeTruthy();
    expect(screen.getByText('Are you sure you want to delete this record?')).toBeTruthy();
  });

  it('renders default confirm and cancel labels', () => {
    const { container } = render(<ConfirmDialog {...defaultProps} />);
    const buttons = container.querySelectorAll('button');
    const labels = Array.from(buttons).map((b) => b.textContent);
    expect(labels).toContain('确认');
    expect(labels).toContain('取消');
  });

  it('renders custom labels', () => {
    render(<ConfirmDialog {...defaultProps} confirmLabel="Yes" cancelLabel="No" />);
    expect(screen.getByText('Yes')).toBeTruthy();
    expect(screen.getByText('No')).toBeTruthy();
  });

  it('calls onConfirm when confirm button clicked', () => {
    const onConfirm = vi.fn();
    const { container } = render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />);
    const buttons = container.querySelectorAll('button');
    const confirmBtn = Array.from(buttons).find((b) => b.textContent === '确认');
    fireEvent.click(confirmBtn!);
    expect(onConfirm).toHaveBeenCalled();
  });

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    const { container } = render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
    const buttons = container.querySelectorAll('button');
    const cancelBtn = Array.from(buttons).find((b) => b.textContent === '取消');
    fireEvent.click(cancelBtn!);
    expect(onCancel).toHaveBeenCalled();
  });

  it('uses red button for danger mode', () => {
    const { container } = render(<ConfirmDialog {...defaultProps} danger />);
    const buttons = container.querySelectorAll('button');
    const confirmBtn = Array.from(buttons).find((b) => b.textContent === '确认');
    expect(confirmBtn?.className).toContain('bg-red-600');
  });

  it('uses blue button for non-danger mode', () => {
    const { container } = render(<ConfirmDialog {...defaultProps} />);
    const buttons = container.querySelectorAll('button');
    const confirmBtn = Array.from(buttons).find((b) => b.textContent === '确认');
    expect(confirmBtn?.className).toContain('bg-blue-600');
  });

  it('has alertdialog role', () => {
    const { container } = render(<ConfirmDialog {...defaultProps} />);
    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog).toBeTruthy();
  });
});
