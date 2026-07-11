import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Pagination } from '@/components/common/Pagination';

afterEach(cleanup);

describe('Pagination', () => {
  it('renders prev and next buttons', () => {
    const { container } = render(<Pagination nextCursor="abc" onNext={() => {}} />);
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(2);
  });

  it('prev button is disabled when hasPrev is false', () => {
    const { container } = render(<Pagination nextCursor="abc" onPrev={() => {}} onNext={() => {}} hasPrev={false} />);
    const buttons = container.querySelectorAll('button');
    expect(buttons[0]!.hasAttribute('disabled')).toBe(true);
  });

  it('prev button is disabled when onPrev is not provided', () => {
    const { container } = render(<Pagination nextCursor="abc" onNext={() => {}} hasPrev />);
    const buttons = container.querySelectorAll('button');
    expect(buttons[0]!.hasAttribute('disabled')).toBe(true);
  });

  it('prev button is enabled when hasPrev and onPrev are set', () => {
    const { container } = render(<Pagination nextCursor="abc" onPrev={() => {}} onNext={() => {}} hasPrev />);
    const buttons = container.querySelectorAll('button');
    expect(buttons[0]!.hasAttribute('disabled')).toBe(false);
  });

  it('calls onPrev when prev button clicked', () => {
    const onPrev = vi.fn();
    const { container } = render(<Pagination nextCursor="abc" onPrev={onPrev} onNext={() => {}} hasPrev />);
    const buttons = container.querySelectorAll('button');
    buttons[0]!.click();
    expect(onPrev).toHaveBeenCalled();
  });

  it('next button is disabled when nextCursor is null', () => {
    const { container } = render(<Pagination nextCursor={null} onNext={() => {}} />);
    const buttons = container.querySelectorAll('button');
    expect(buttons[1]!.hasAttribute('disabled')).toBe(true);
  });

  it('calls onNext with cursor when next button clicked', () => {
    const onNext = vi.fn();
    const { container } = render(<Pagination nextCursor="cursor123" onNext={onNext} />);
    const buttons = container.querySelectorAll('button');
    buttons[1]!.click();
    expect(onNext).toHaveBeenCalledWith('cursor123');
  });
});
