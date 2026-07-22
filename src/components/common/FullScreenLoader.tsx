interface FullScreenLoaderProps {
  label?: string;
}

export function FullScreenLoader({ label = '正在加载…' }: FullScreenLoaderProps) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-white">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
        <p className="text-sm text-gray-600">{label}</p>
      </div>
    </div>
  );
}
