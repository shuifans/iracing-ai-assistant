-- Migration: 20260715000001_H_seed_web_knowledge_sources
-- Description: Import the reviewed legacy Web allowlist only when the runtime registry is empty.

PRAGMA foreign_keys = ON;

-- A temporary guard makes this a one-time all-or-nothing import. Existing administrator-maintained
-- rows suppress both the source import and creation of the non-login attribution principal.
CREATE TEMP TABLE __web_source_seed_guard (should_seed INTEGER NOT NULL);
INSERT INTO __web_source_seed_guard (should_seed)
SELECT CASE WHEN EXISTS (SELECT 1 FROM web_knowledge_sources) THEN 0 ELSE 1 END;

INSERT INTO users
  (id, username, password_hash, role, status, created_at, updated_at)
SELECT
  'system:web-source-seed',
  '__system_web_source_seed__',
  '!migration-only-no-login!',
  'knowledge_admin',
  'disabled',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM __web_source_seed_guard
WHERE should_seed = 1;

WITH seed (id, name, scope_type, url, source_level, description) AS (
  VALUES
    ('seed-web-support-iracing', 'iRacing Support Knowledge Base', 'domain', 'https://support.iracing.com', 'official', '官方知识库、Getting Started 与驾驶教程'),
    ('seed-web-iracing-new-racer', 'iRacing New Racer Guide', 'path', 'https://www.iracing.com/new-racer-guide', 'official', '官方新手指南与赛事入门流程'),
    ('seed-web-iracing-tracks', 'iRacing 官方赛道页', 'path', 'https://www.iracing.com/tracks', 'official', '官方赛道介绍与配置信息'),
    ('seed-web-iracing-cars', 'iRacing 官方车辆页', 'path', 'https://www.iracing.com/cars', 'official', '官方车辆信息与分类'),
    ('seed-web-iracing-series', 'iRacing 官方赛事系列', 'path', 'https://www.iracing.com/series', 'official', '官方赛事系列与玩法说明'),
    ('seed-web-reddit-iracing', 'r/iRacing (Reddit)', 'path', 'https://www.reddit.com/r/iRacing', 'community', '社区驾驶技巧、赛道攻略与调校讨论'),
    ('seed-web-hipole-beginner', 'HiPole 嗨跑赛车新手入门', 'path', 'https://www.hipole.com/kb/videos-beginner', 'community', '中文 iRacing 入门教程'),
    ('seed-web-coach-dave', 'Coach Dave Academy 教程', 'path', 'https://coachdaveacademy.com/tutorials', 'community', '调校与遥测教程'),
    ('seed-web-porsche-masterclass', 'Porsche × Max Benecke 调校指南', 'exact_url', 'https://newsroom.porsche.com/zh/2020/motorsports/cn-porsche-masterclass-part-9', 'community', '职业车手调校方法论')
)
INSERT INTO web_knowledge_sources
  (id, name, scope_type, url, source_level, enabled, description, created_by, updated_by, created_at, updated_at)
SELECT
  seed.id,
  seed.name,
  seed.scope_type,
  seed.url,
  seed.source_level,
  1,
  seed.description,
  'system:web-source-seed',
  'system:web-source-seed',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM seed
JOIN __web_source_seed_guard ON should_seed = 1;

DROP TABLE __web_source_seed_guard;
