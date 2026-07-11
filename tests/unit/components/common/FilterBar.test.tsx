import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FilterBar } from '@/components/common/FilterBar';

afterEach(cleanup);

const filters = [
  { name: 'status', label: 'Status', type: 'select' as const, options: [{ value: 'active', label: 'Active' }] },
  { name: 'keyword', label: 'Keyword', type: 'text' as const },
  { name: 'from', label: 'From', type: 'date' as const },
];

describe('FilterBar', () => {
  it('renders all filter labels', () => {
    render(<FilterBar filters={filters} values={{}} onChange={() => {}} />);
    expect(screen.getByText('Status')).toBeTruthy();
    expect(screen.getByText('Keyword')).toBeTruthy();
    expect(screen.getByText('From')).toBeTruthy();
  });

  it('renders select with options', () => {
    const { container } = render(<FilterBar filters={filters} values={{}} onChange={() => {}} />);
    const select = container.querySelector('select');
    expect(select).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('renders text input with placeholder', () => {
    render(<FilterBar filters={filters} values={{}} onChange={() => {}} />);
    expect(screen.getByPlaceholderText('输入Keyword…')).toBeTruthy();
  });

  it('renders date input', () => {
    const { container } = render(<FilterBar filters={filters} values={{}} onChange={() => {}} />);
    const dateInput = container.querySelector('input[type="date"]');
    expect(dateInput).toBeTruthy();
  });

  it('calls onChange when select changes', () => {
    const onChange = vi.fn();
    const { container } = render(<FilterBar filters={filters} values={{}} onChange={onChange} />);
    const select = container.querySelector('select')!;
    fireEvent.change(select, { target: { value: 'active' } });
    expect(onChange).toHaveBeenCalledWith('status', 'active');
  });

  it('calls onChange when text input changes', () => {
    const onChange = vi.fn();
    render(<FilterBar filters={filters} values={{}} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText('输入Keyword…'), { target: { value: 'test' } });
    expect(onChange).toHaveBeenCalledWith('keyword', 'test');
  });

  it('renders search button when onSearch provided', () => {
    render(<FilterBar filters={filters} values={{}} onChange={() => {}} onSearch={() => {}} />);
    expect(screen.getByText('搜索')).toBeTruthy();
  });

  it('does not render search button when onSearch not provided', () => {
    render(<FilterBar filters={filters} values={{}} onChange={() => {}} />);
    expect(screen.queryByText('搜索')).toBeNull();
  });

  it('calls onSearch when search button clicked', () => {
    const onSearch = vi.fn();
    render(<FilterBar filters={filters} values={{ search: 'hello' }} onChange={() => {}} onSearch={onSearch} />);
    fireEvent.click(screen.getByText('搜索'));
    expect(onSearch).toHaveBeenCalledWith('hello');
  });
});
