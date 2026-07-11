import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DataTable } from '@/components/common/DataTable';

afterEach(cleanup);

const columns = [
  { key: 'name', header: 'Name' },
  { key: 'email', header: 'Email' },
];

const data = [
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob', email: 'bob@example.com' },
];

describe('DataTable', () => {
  it('renders column headers', () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('Email')).toBeTruthy();
  });

  it('renders data rows', () => {
    const { container } = render(<DataTable columns={columns} data={data} />);
    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(container.textContent).toContain('Alice');
    expect(container.textContent).toContain('bob@example.com');
  });

  it('shows empty message when data is empty', () => {
    render(<DataTable columns={columns} data={[]} />);
    expect(screen.getByText('暂无数据')).toBeTruthy();
  });

  it('shows custom empty message', () => {
    render(<DataTable columns={columns} data={[]} emptyMessage="No records found" />);
    expect(screen.getByText('No records found')).toBeTruthy();
  });

  it('shows skeleton rows when loading', () => {
    const { container } = render(<DataTable columns={columns} data={[]} loading />);
    const pulseRows = container.querySelectorAll('.animate-pulse');
    expect(pulseRows.length).toBe(4);
  });

  it('uses custom render function for column', () => {
    const customColumns = [
      { key: 'name', header: 'Name', render: (item: Record<string, unknown>) => <strong>{item.name as string}</strong> },
      { key: 'email', header: 'Email' },
    ];
    const { container } = render(<DataTable columns={customColumns} data={data} />);
    const strong = container.querySelector('strong');
    expect(strong?.textContent).toBe('Alice');
  });

  it('renders table element', () => {
    const { container } = render(<DataTable columns={columns} data={data} />);
    const table = container.querySelector('table');
    expect(table).toBeTruthy();
  });
});
