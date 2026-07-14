// 角色（SPEC 9.3）
export const USER_ROLES = ['user', 'knowledge_admin', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

// 用户状态（SPEC 8.1）
export const USER_STATUSES = ['pending', 'active', 'rejected', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

// 会话状态（SPEC 8.2）
export const SESSION_STATUSES = ['active', 'archived'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

// 消息角色与状态（SPEC 8.2）
export const MESSAGE_ROLES = ['user', 'assistant', 'system'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];
export const MESSAGE_STATUSES = [
  'pending',
  'streaming',
  'complete',
  'interrupted',
  'failed',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

// 知识来源状态（SPEC 8.3）
export const KNOWLEDGE_SOURCE_STATUSES = [
  'stored',
  'queued',
  'processing',
  'ready',
  'failed',
  'archived',
] as const;
export type KnowledgeSourceStatus = (typeof KNOWLEDGE_SOURCE_STATUSES)[number];

// 任务状态（SPEC 8.3）
export const JOB_STATUSES = [
  'queued',
  'extracting',
  'cleaning',
  'pending_review',
  'publishing',
  'published',
  'rejected',
  'failed',
  'cancelled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

// 候选稿状态（SPEC 8.3）
export const DRAFT_STATUSES = ['pending_review', 'approved', 'rejected', 'superseded'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

// 知识条目状态
export const KNOWLEDGE_ITEM_STATUSES = ['published', 'archived'] as const;
export type KnowledgeItemStatus = (typeof KNOWLEDGE_ITEM_STATUSES)[number];

// Wiki 同步状态（SPEC 8.3）
export const WIKI_SYNC_STATUSES = ['committed', 'push_pending', 'synced', 'push_failed'] as const;
export type WikiSyncStatus = (typeof WIKI_SYNC_STATUSES)[number];

// 知识评估等级（A≥85 / B70-84 / C60-69 / D<60；pending=未评估）
export const EVALUATION_TIERS = ['A', 'B', 'C', 'D', 'pending'] as const;
export type EvaluationTier = (typeof EVALUATION_TIERS)[number];

// 知识评估状态
export const EVALUATION_STATUSES = [
  'pending',
  'heuristic_done',
  'deep_running',
  'complete',
  'failed',
] as const;
export type EvaluationStatus = (typeof EVALUATION_STATUSES)[number];

// 评估维度所属层（heuristic=启发式 / probe=检索探针 / llm=LLM 评审）
export const DIMENSION_TIERS = ['heuristic', 'probe', 'llm'] as const;
export type DimensionTier = (typeof DIMENSION_TIERS)[number];

// 评估维度键（与 evaluation_dimensions.dimension_key 对应）
export const EVALUATION_DIMENSION_KEYS = [
  'front_matter_validity',
  'content_length',
  'tag_category_sanity',
  'dedup_overlap',
  'freshness',
  'retrievability',
  'accuracy',
  'completeness',
  'clarity',
] as const;
export type EvalDimensionKey = (typeof EVALUATION_DIMENSION_KEYS)[number];

// 分类与子分类（SPEC 13.5）
export const KNOWLEDGE_CATEGORIES = {
  'official-racing': [
    'schedule-and-season',
    'series-and-events',
    'sporting-code',
    'race-procedures',
    'licenses-and-ratings',
    'protests-and-penalties',
    'special-events',
  ],
  'getting-started': [
    'account-and-membership',
    'content-and-purchasing',
    'installation-and-configuration',
    'first-race',
    'ui-and-registration',
    'leagues-and-hosted-racing',
    'troubleshooting',
  ],
  'driving-technique': [
    'driving-fundamentals',
    'racing-line',
    'braking',
    'cornering',
    'racecraft',
    'starts-and-restarts',
    'overtaking-and-defense',
    'tire-management',
    'wet-weather',
    'telemetry-analysis',
  ],
  'car-setup': [
    'setup-fundamentals',
    'tires-and-pressures',
    'suspension',
    'alignment',
    'aerodynamics',
    'drivetrain-and-gearing',
    'brakes',
    'electronics',
    'oval-setup',
    'presets-and-tools',
  ],
  'cars-and-tracks': ['car-reference', 'car-guide', 'track-reference', 'track-guide'],
  'hardware-and-software': [
    'wheels-and-pedals',
    'force-feedback',
    'vr-and-displays',
    'pc-and-performance',
    'telemetry-tools',
    'third-party-apps',
  ],
} as const;
export type KnowledgeCategory = keyof typeof KNOWLEDGE_CATEGORIES;

// 限流作用域（SPEC 16）
export const RATE_LIMIT_SCOPES = ['global', 'role', 'user'] as const;
export type RateLimitScope = (typeof RATE_LIMIT_SCOPES)[number];

// 反馈评分
export const FEEDBACK_RATINGS = ['up', 'down'] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];

// 对话答案后端选择（SPEC §11.1 — 多轮对话生成方案开关）
// - 'llm-direct'：BM25 本地检索 + OpenAI 兼容 LLM 直调（默认，最快，当前 LongCat-2.0）
// - 'qoder-sdk' ：Qoder Agent SDK + Qwen3.7-Plus 全量 Agent 循环（wiki-search + web-research 子 Agent）
// 经 `CHAT_ANSWER_BACKEND` 环境变量切换；默认 'llm-direct'。
export const CHAT_ANSWER_BACKENDS = ['llm-direct', 'qoder-sdk'] as const;
export type ChatAnswerBackend = (typeof CHAT_ANSWER_BACKENDS)[number];

// 业务错误码（SPEC 14.6 完整覆盖 — 22 个）
export const ERROR_CODES = {
  VALIDATION_ERROR: { http: 400, code: 'VALIDATION_ERROR' as const },
  UNAUTHENTICATED: { http: 401, code: 'UNAUTHENTICATED' as const },
  INVALID_CREDENTIALS: { http: 401, code: 'INVALID_CREDENTIALS' as const },
  TOKEN_REUSED: { http: 401, code: 'TOKEN_REUSED' as const },
  FORBIDDEN: { http: 403, code: 'FORBIDDEN' as const },
  ACCOUNT_PENDING: { http: 403, code: 'ACCOUNT_PENDING' as const },
  ACCOUNT_DISABLED: { http: 403, code: 'ACCOUNT_DISABLED' as const },
  NOT_FOUND: { http: 404, code: 'NOT_FOUND' as const },
  CONFLICT: { http: 409, code: 'CONFLICT' as const },
  DUPLICATE_SOURCE: { http: 409, code: 'DUPLICATE_SOURCE' as const },
  INVALID_STATE: { http: 409, code: 'INVALID_STATE' as const },
  FILE_TOO_LARGE: { http: 413, code: 'FILE_TOO_LARGE' as const },
  CONTENT_TOO_LARGE: { http: 413, code: 'CONTENT_TOO_LARGE' as const },
  UNSUPPORTED_MEDIA_TYPE: { http: 415, code: 'UNSUPPORTED_MEDIA_TYPE' as const },
  PDF_OCR_REQUIRED: { http: 415, code: 'PDF_OCR_REQUIRED' as const },
  EXTRACTION_FAILED: { http: 422, code: 'EXTRACTION_FAILED' as const },
  DRAFT_INVALID: { http: 422, code: 'DRAFT_INVALID' as const },
  RATE_LIMITED: { http: 429, code: 'RATE_LIMITED' as const },
  AGENT_UNAVAILABLE: { http: 502, code: 'AGENT_UNAVAILABLE' as const },
  WEB_FETCH_FAILED: { http: 502, code: 'WEB_FETCH_FAILED' as const },
  AGENT_AUTH_EXPIRED: { http: 503, code: 'AGENT_AUTH_EXPIRED' as const },
  SERVICE_NOT_READY: { http: 503, code: 'SERVICE_NOT_READY' as const },
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;
