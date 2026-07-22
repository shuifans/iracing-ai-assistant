import { SessionSidebar } from '@/components/chat/SessionSidebar';

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] overflow-hidden bg-gray-50">
      <SessionSidebar />
      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
