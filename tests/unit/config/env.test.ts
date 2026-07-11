import { describe, it, expect } from 'vitest';
import { parseEnv } from '../../../src/config/env';

// 最小必需变量集（必填字段）
const minimalValid = {
  JWT_ACCESS_SECRET: 'test-jwt-secret',
  REFRESH_TOKEN_PEPPER: 'test-refresh-pepper',
  IP_HASH_PEPPER: 'test-ip-pepper',
  QODER_PERSONAL_ACCESS_TOKEN: 'test-qoder-token',
};

describe('env validation', () => {
  it('parses all required variables correctly', () => {
    const result = parseEnv(minimalValid);
    expect(result.JWT_ACCESS_SECRET).toBe('test-jwt-secret');
    expect(result.REFRESH_TOKEN_PEPPER).toBe('test-refresh-pepper');
    expect(result.IP_HASH_PEPPER).toBe('test-ip-pepper');
    expect(result.QODER_PERSONAL_ACCESS_TOKEN).toBe('test-qoder-token');
  });

  it('throws on missing JWT_ACCESS_SECRET', () => {
    const input = { ...minimalValid, JWT_ACCESS_SECRET: undefined };
    expect(() => parseEnv(input)).toThrow();
  });

  it('throws on missing REFRESH_TOKEN_PEPPER', () => {
    const input = { ...minimalValid, REFRESH_TOKEN_PEPPER: undefined };
    expect(() => parseEnv(input)).toThrow();
  });

  it('throws on missing IP_HASH_PEPPER', () => {
    const input = { ...minimalValid, IP_HASH_PEPPER: undefined };
    expect(() => parseEnv(input)).toThrow();
  });

  it('throws on missing QODER_PERSONAL_ACCESS_TOKEN', () => {
    const input = { ...minimalValid, QODER_PERSONAL_ACCESS_TOKEN: undefined };
    expect(() => parseEnv(input)).toThrow();
  });

  it('throws on empty string JWT_ACCESS_SECRET', () => {
    const input = { ...minimalValid, JWT_ACCESS_SECRET: '' };
    expect(() => parseEnv(input)).toThrow();
  });

  it('throws on invalid PORT', () => {
    const input = { ...minimalValid, PORT: 'not-a-number' };
    expect(() => parseEnv(input)).toThrow();
  });

  it('throws on negative PORT', () => {
    const input = { ...minimalValid, PORT: '-1' };
    expect(() => parseEnv(input)).toThrow();
  });

  it('throws on zero PORT', () => {
    const input = { ...minimalValid, PORT: '0' };
    expect(() => parseEnv(input)).toThrow();
  });

  it('fills default values correctly', () => {
    const result = parseEnv(minimalValid);
    expect(result.NODE_ENV).toBe('development');
    expect(result.APP_BASE_URL).toBe('http://localhost:3000');
    expect(result.PORT).toBe(3000);
    expect(result.TZ).toBe('Asia/Shanghai');
    expect(result.DATABASE_PATH).toBe('/data/db/app.sqlite');
    expect(result.DATA_ROOT).toBe('/data');
    expect(result.WIKI_ROOT).toBe('/data/md-wiki');
    expect(result.WIKI_GIT_BRANCH).toBe('main');
    expect(result.QODER_CHAT_TIMEOUT_MS).toBe(120000);
    expect(result.QODER_CLEAN_TIMEOUT_MS).toBe(900000);
    expect(result.KNOWLEDGE_WORKER_CONCURRENCY).toBe(1);
    expect(result.KNOWLEDGE_JOB_LEASE_SECONDS).toBe(300);
    expect(result.UPLOAD_IMAGE_MAX_BYTES).toBe(10485760);
    expect(result.UPLOAD_KNOWLEDGE_MAX_BYTES).toBe(26214400);
    expect(result.URL_FETCH_MAX_BYTES).toBe(5242880);
    expect(result.LOG_LEVEL).toBe('info');
    expect(result.BACKUP_ROOT).toBe('/data/backups');
  });

  it('bootstrap variables are optional when not set', () => {
    const result = parseEnv(minimalValid);
    expect(result.BOOTSTRAP_ADMIN_USERNAME).toBeUndefined();
    expect(result.BOOTSTRAP_ADMIN_PASSWORD).toBeUndefined();
  });

  it('bootstrap variables are present when set', () => {
    const result = parseEnv({
      ...minimalValid,
      BOOTSTRAP_ADMIN_USERNAME: 'admin',
      BOOTSTRAP_ADMIN_PASSWORD: 'adminpass',
    });
    expect(result.BOOTSTRAP_ADMIN_USERNAME).toBe('admin');
    expect(result.BOOTSTRAP_ADMIN_PASSWORD).toBe('adminpass');
  });

  it('coerces numeric string values to numbers', () => {
    const result = parseEnv({
      ...minimalValid,
      PORT: '8080',
      QODER_CHAT_TIMEOUT_MS: '60000',
      QODER_CLEAN_TIMEOUT_MS: '300000',
      KNOWLEDGE_WORKER_CONCURRENCY: '4',
      KNOWLEDGE_JOB_LEASE_SECONDS: '600',
      UPLOAD_IMAGE_MAX_BYTES: '5242880',
      UPLOAD_KNOWLEDGE_MAX_BYTES: '52428800',
      URL_FETCH_MAX_BYTES: '10485760',
    });
    expect(result.PORT).toBe(8080);
    expect(result.QODER_CHAT_TIMEOUT_MS).toBe(60000);
    expect(result.QODER_CLEAN_TIMEOUT_MS).toBe(300000);
    expect(result.KNOWLEDGE_WORKER_CONCURRENCY).toBe(4);
    expect(result.KNOWLEDGE_JOB_LEASE_SECONDS).toBe(600);
    expect(result.UPLOAD_IMAGE_MAX_BYTES).toBe(5242880);
    expect(result.UPLOAD_KNOWLEDGE_MAX_BYTES).toBe(52428800);
    expect(result.URL_FETCH_MAX_BYTES).toBe(10485760);
  });

  it('accepts valid NODE_ENV values', () => {
    for (const nodeEnv of ['development', 'test', 'production']) {
      const result = parseEnv({ ...minimalValid, NODE_ENV: nodeEnv });
      expect(result.NODE_ENV).toBe(nodeEnv);
    }
  });

  it('throws on invalid NODE_ENV', () => {
    const input = { ...minimalValid, NODE_ENV: 'staging' };
    expect(() => parseEnv(input)).toThrow();
  });

  it('optional variables are undefined when not set', () => {
    const result = parseEnv(minimalValid);
    expect(result.WIKI_GIT_REMOTE).toBeUndefined();
    expect(result.QODER_MODEL).toBeUndefined();
    expect(result.IQS_API_BASE_URL).toBeUndefined();
    expect(result.IQS_API_KEY).toBeUndefined();
  });

  it('optional variables are present when set', () => {
    const result = parseEnv({
      ...minimalValid,
      WIKI_GIT_REMOTE: 'git@github.com:test/test.git',
      QODER_MODEL: 'gpt-4',
      IQS_API_BASE_URL: 'https://api.example.com',
      IQS_API_KEY: 'api-key-123',
    });
    expect(result.WIKI_GIT_REMOTE).toBe('git@github.com:test/test.git');
    expect(result.QODER_MODEL).toBe('gpt-4');
    expect(result.IQS_API_BASE_URL).toBe('https://api.example.com');
    expect(result.IQS_API_KEY).toBe('api-key-123');
  });
});
