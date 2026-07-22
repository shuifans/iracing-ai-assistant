'use client';

interface FilterBarProps {
  filters: {
    name: string;
    label: string;
    type: 'select' | 'text' | 'date';
    options?: { value: string; label: string }[];
  }[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  onSearch?: (query: string) => void;
}

export function FilterBar({ filters, values, onChange, onSearch }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 bg-white p-4">
      {filters.map((filter) => (
        <div key={filter.name} className="flex min-w-[140px] flex-1 flex-col gap-1">
          <label
            htmlFor={`filter-${filter.name}`}
            className="text-xs font-medium text-gray-600"
          >
            {filter.label}
          </label>

          {filter.type === 'select' ? (
            <select
              id={`filter-${filter.name}`}
              value={values[filter.name] ?? ''}
              onChange={(e) => onChange(filter.name, e.target.value)}
              className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">全部</option>
              {filter.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : filter.type === 'date' ? (
            <input
              id={`filter-${filter.name}`}
              type="date"
              value={values[filter.name] ?? ''}
              onChange={(e) => onChange(filter.name, e.target.value)}
              className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          ) : (
            <input
              id={`filter-${filter.name}`}
              type="text"
              placeholder={`输入${filter.label}…`}
              value={values[filter.name] ?? ''}
              onChange={(e) => onChange(filter.name, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && onSearch) {
                  onSearch(values[filter.name] ?? '');
                }
              }}
              className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          )}
        </div>
      ))}

      {onSearch && (
        <button
          type="button"
          onClick={() => onSearch(values['search'] ?? '')}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        >
          搜索
        </button>
      )}
    </div>
  );
}
