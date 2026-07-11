import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '@/components/common/Badge';

describe('Badge', () => {
  it('renders label text', () => {
    render(<Badge label="Active" />);
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('applies default variant classes', () => {
    render(<Badge label="Default" />);
    const el = screen.getByText('Default');
    expect(el.className).toContain('bg-gray-100');
    expect(el.className).toContain('text-gray-700');
  });

  it('applies success variant classes', () => {
    render(<Badge label="OK" variant="success" />);
    const el = screen.getByText('OK');
    expect(el.className).toContain('bg-green-100');
    expect(el.className).toContain('text-green-700');
  });

  it('applies warning variant classes', () => {
    render(<Badge label="Warn" variant="warning" />);
    const el = screen.getByText('Warn');
    expect(el.className).toContain('bg-yellow-100');
  });

  it('applies danger variant classes', () => {
    render(<Badge label="Error" variant="danger" />);
    const el = screen.getByText('Error');
    expect(el.className).toContain('bg-red-100');
  });

  it('applies info variant classes', () => {
    render(<Badge label="Info" variant="info" />);
    const el = screen.getByText('Info');
    expect(el.className).toContain('bg-blue-100');
  });

  it('renders as inline-flex span', () => {
    render(<Badge label="Test" />);
    const el = screen.getByText('Test');
    expect(el.tagName).toBe('SPAN');
    expect(el.className).toContain('inline-flex');
  });
});
