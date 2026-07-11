export interface AuthenticatedUser {
  id: string;
  username: string;
  role: 'user' | 'knowledge_admin' | 'admin';
  status: 'active';
}
