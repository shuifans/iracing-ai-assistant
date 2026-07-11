import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs } from '@/components/common/Tabs';

const tabs = [
  { id: 'tab1', label: 'Overview' },
  { id: 'tab2', label: 'Users' },
  { id: 'tab3', label: 'Settings' },
];

describe('Tabs', () => {
  it('renders all tab labels', () => {
    render(<Tabs tabs={tabs} activeTab="tab1" onChange={() => {}} />);
    expect(screen.getByText('Overview')).toBeTruthy();
    expect(screen.getByText('Users')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('marks active tab with aria-selected true', () => {
    const { container } = render(<Tabs tabs={tabs} activeTab="tab2" onChange={() => {}} />);
    const tabButtons = container.querySelectorAll('[role="tab"]');
    const activeBtn = tabButtons[1];
    expect(activeBtn?.getAttribute('aria-selected')).toBe('true');
  });

  it('inactive tab has aria-selected false', () => {
    const { container } = render(<Tabs tabs={tabs} activeTab="tab1" onChange={() => {}} />);
    const tabButtons = container.querySelectorAll('[role="tab"]');
    const inactiveBtn = tabButtons[2];
    expect(inactiveBtn?.getAttribute('aria-selected')).toBe('false');
  });

  it('active tab has blue border class', () => {
    const { container } = render(<Tabs tabs={tabs} activeTab="tab1" onChange={() => {}} />);
    const tabButtons = container.querySelectorAll('[role="tab"]');
    const activeBtn = tabButtons[0];
    expect(activeBtn?.className).toContain('border-blue-500');
  });

  it('calls onChange with tab id on click', () => {
    const onChange = vi.fn();
    const { container } = render(<Tabs tabs={tabs} activeTab="tab1" onChange={onChange} />);
    const tabButtons = container.querySelectorAll('[role="tab"]');
    fireEvent.click(tabButtons[1]!);
    expect(onChange).toHaveBeenCalledWith('tab2');
  });

  it('renders correct number of tab buttons', () => {
    const { container } = render(<Tabs tabs={tabs} activeTab="tab1" onChange={() => {}} />);
    const tabButtons = container.querySelectorAll('[role="tab"]');
    expect(tabButtons.length).toBe(3);
  });
});
