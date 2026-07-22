export interface ModuleLink {
  href: string;
  label: string;
  roles: readonly string[];
}

export const MODULES: readonly ModuleLink[] = [
  { href: '/chat', label: '对话', roles: ['user', 'knowledge_admin', 'admin'] },
  { href: '/knowledge', label: '知识管理', roles: ['knowledge_admin', 'admin'] },
  { href: '/admin', label: '账户管理', roles: ['admin'] },
] as const;

export function modulesForRole(role: string | null | undefined): ModuleLink[] {
  if (!role) return [];
  return MODULES.filter((m) => m.roles.includes(role));
}

export const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  knowledge_admin: '知识管理员',
  user: '用户',
};
