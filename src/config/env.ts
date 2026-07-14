import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  PORT: z.coerce.number().int().positive().default(3000),
  TZ: z.string().default('Asia/Shanghai'),
  DATABASE_PATH: z.string().default('/data/db/app.sqlite'),
  DATA_ROOT: z.string().default('/data'),
  WIKI_ROOT: z.string().default('/data/md-wiki'),
  WIKI_GIT_REMOTE: z.string().optional(),
  WIKI_GIT_BRANCH: z.string().default('main'),
  JWT_ACCESS_SECRET: z.string().min(1),
  REFRESH_TOKEN_PEPPER: z.string().min(1),
  IP_HASH_PEPPER: z.string().min(1),
  QODER_PERSONAL_ACCESS_TOKEN: z.string().min(1),
  QODER_MODEL: z.string().optional(),
  QODER_CHAT_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  QODER_CLEAN_TIMEOUT_MS: z.coerce.number().int().positive().default(900000),
  // 对话答案后端开关（llm-direct=BM25+OpenAI 兼容直调[默认] | qoder-sdk=Qoder SDK 全量循环）
  CHAT_ANSWER_BACKEND: z.enum(['llm-direct', 'qoder-sdk']).default('llm-direct'),
  // 知识清洗后端单次 LLM 请求超时（毫秒，worker llm-direct 路径用）
  LLM_CLEAN_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  // 知识清洗模型切换密码的 bcrypt 哈希（cost 12）。留空则禁用后台切换（仅默认 LongCat 清洗）。
  MODEL_SWITCH_PASSWORD_HASH: z.string().optional(),
  // 对话 LLM 直调端点（OpenAI 兼容）。留空则回退到 LONGCAT_* 别名（与知识清洗共用配置）。
  LLM_API_BASE_URL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('LongCat-2.0'),
  IQS_API_BASE_URL: z.string().optional(),
  IQS_API_KEY: z.string().optional(),
  KNOWLEDGE_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(1),
  KNOWLEDGE_JOB_LEASE_SECONDS: z.coerce.number().int().positive().default(300),
  UPLOAD_IMAGE_MAX_BYTES: z.coerce.number().int().positive().default(10485760),
  UPLOAD_KNOWLEDGE_MAX_BYTES: z.coerce.number().int().positive().default(26214400),
  URL_FETCH_MAX_BYTES: z.coerce.number().int().positive().default(5242880),
  LOG_LEVEL: z.string().default('info'),
  BACKUP_ROOT: z.string().default('/data/backups'),
  // Bootstrap - optional, only validated when explicitly set
  BOOTSTRAP_ADMIN_USERNAME: z.string().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(input: Record<string, string | undefined>): Env {
  return envSchema.parse(input);
}

// Lazy singleton for production use
let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    try {
      _env = parseEnv(process.env as Record<string, string | undefined>);
    } catch (err) {
      if (process.env.NODE_ENV === 'production') {
        console.error('[ENV] Validation failed:', err);
        process.exit(1);
      }
      throw err;
    }
  }
  return _env;
}

// 导出便捷访问（生产环境使用）
export const env = new Proxy({} as Env, {
  get: (_target, prop: string) => getEnv()[prop as keyof Env],
});
