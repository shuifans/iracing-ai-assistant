'use client';

import { createContext, useContext, useMemo, useState } from 'react';

interface ShellContextValue {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const value = useMemo(() => ({ sidebarOpen, setSidebarOpen }), [sidebarOpen]);
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) {
    throw new Error('useShell 必须在 ShellProvider 内使用');
  }
  return ctx;
}
