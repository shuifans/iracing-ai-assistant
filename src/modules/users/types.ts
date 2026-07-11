export interface UserListParams {
  status?: string;
  role?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}

export interface UserListResult {
  users: UserSummary[];
  nextCursor: string | null;
}

export interface UserSummary {
  id: string;
  username: string;
  role: string;
  status: string;
  registrationReason: string | null;
  rejectionReason: string | null;
  createdAt: string;
  approvedAt: string | null;
  lastLoginAt: string | null;
}
