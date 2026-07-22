'use client';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
}

const trendConfig = {
  up: { arrow: '↑', color: 'text-green-600' },
  down: { arrow: '↓', color: 'text-red-600' },
  neutral: { arrow: '→', color: 'text-gray-500' },
};

export function StatCard({ title, value, subtitle, trend }: StatCardProps) {
  return (
    <div className="rounded-card border border-gray-200 bg-white p-5 shadow-card">
      <p className="text-sm font-medium text-gray-500">{title}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <p className="text-2xl font-bold text-navy-900">{value}</p>
        {trend && (
          <span data-trend={trend} className={`text-sm font-medium ${trendConfig[trend].color}`}>
            {trendConfig[trend].arrow}
          </span>
        )}
      </div>
      {subtitle && <p className="mt-1 text-xs text-gray-400">{subtitle}</p>}
    </div>
  );
}
