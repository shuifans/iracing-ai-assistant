import { SessionListContent } from './SessionListContent';

export function SessionSidebar() {
  return (
    <aside
      className="hidden w-72 flex-shrink-0 flex-col border-r border-gray-200 bg-white md:flex"
      aria-label="会话历史"
    >
      <SessionListContent />
    </aside>
  );
}
