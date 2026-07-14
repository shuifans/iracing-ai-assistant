-- Migration: 20260714000000_D_seed_rate_limit_defaults
-- Description: Seed safe, enabled defaults for every chat rate-limit scope.

PRAGMA foreign_keys = ON;

-- Preserve administrator-customized rows on existing deployments.
INSERT INTO rate_limit_configs
  (id, scope, scope_key, per_minute_limit, per_day_limit, max_session_turns, enabled, created_at, updated_at)
VALUES
  ('rlc-default-global', 'global', 'global', 60, 2000, 30, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('rlc-default-role-user', 'role', 'user', 30, 500, 30, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('rlc-default-role-knowledge-admin', 'role', 'knowledge_admin', 60, 1000, 30, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('rlc-default-role-admin', 'role', 'admin', 120, 2000, 30, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('rlc-default-user-wildcard', 'user', '*', 10, 100, 30, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(scope, scope_key) DO NOTHING;
