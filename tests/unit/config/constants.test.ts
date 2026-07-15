import { describe, it, expect } from 'vitest';
import {
  USER_ROLES,
  USER_STATUSES,
  SESSION_STATUSES,
  MESSAGE_ROLES,
  MESSAGE_STATUSES,
  KNOWLEDGE_SOURCE_STATUSES,
  JOB_STATUSES,
  DRAFT_STATUSES,
  KNOWLEDGE_ITEM_STATUSES,
  WIKI_SYNC_STATUSES,
  KNOWLEDGE_CATEGORIES,
  RATE_LIMIT_SCOPES,
  FEEDBACK_RATINGS,
  ERROR_CODES,
} from '../../../src/config/constants';
import * as constants from '../../../src/config/constants';

describe('chat backend constants', () => {
  it('does not expose a legacy chat backend switch', () => {
    const legacyExport = ['CHAT', 'ANSWER', 'BACKENDS'].join('_');
    expect(constants).not.toHaveProperty(legacyExport);
  });
});

describe('USER_ROLES', () => {
  it('contains user, knowledge_admin and admin', () => {
    expect(USER_ROLES).toContain('user');
    expect(USER_ROLES).toContain('knowledge_admin');
    expect(USER_ROLES).toContain('admin');
    expect(USER_ROLES).toHaveLength(3);
  });
});

describe('USER_STATUSES', () => {
  it('contains pending, active, rejected and disabled', () => {
    expect(USER_STATUSES).toContain('pending');
    expect(USER_STATUSES).toContain('active');
    expect(USER_STATUSES).toContain('rejected');
    expect(USER_STATUSES).toContain('disabled');
    expect(USER_STATUSES).toHaveLength(4);
  });
});

describe('SESSION_STATUSES', () => {
  it('contains active and archived', () => {
    expect(SESSION_STATUSES).toContain('active');
    expect(SESSION_STATUSES).toContain('archived');
    expect(SESSION_STATUSES).toHaveLength(2);
  });
});

describe('MESSAGE_ROLES', () => {
  it('contains user, assistant and system', () => {
    expect(MESSAGE_ROLES).toContain('user');
    expect(MESSAGE_ROLES).toContain('assistant');
    expect(MESSAGE_ROLES).toContain('system');
    expect(MESSAGE_ROLES).toHaveLength(3);
  });
});

describe('MESSAGE_STATUSES', () => {
  it('contains all 5 statuses', () => {
    expect(MESSAGE_STATUSES).toHaveLength(5);
    for (const s of ['pending', 'streaming', 'complete', 'interrupted', 'failed']) {
      expect(MESSAGE_STATUSES).toContain(s);
    }
  });
});

describe('KNOWLEDGE_SOURCE_STATUSES', () => {
  it('contains all 6 statuses', () => {
    expect(KNOWLEDGE_SOURCE_STATUSES).toHaveLength(6);
    for (const s of ['stored', 'queued', 'processing', 'ready', 'failed', 'archived']) {
      expect(KNOWLEDGE_SOURCE_STATUSES).toContain(s);
    }
  });
});

describe('JOB_STATUSES', () => {
  it('covers all 9 statuses', () => {
    expect(JOB_STATUSES).toHaveLength(9);
    for (const s of [
      'queued',
      'extracting',
      'cleaning',
      'pending_review',
      'publishing',
      'published',
      'rejected',
      'failed',
      'cancelled',
    ]) {
      expect(JOB_STATUSES).toContain(s);
    }
  });
});

describe('DRAFT_STATUSES', () => {
  it('contains all 4 statuses', () => {
    expect(DRAFT_STATUSES).toHaveLength(4);
    for (const s of ['pending_review', 'approved', 'rejected', 'superseded']) {
      expect(DRAFT_STATUSES).toContain(s);
    }
  });
});

describe('KNOWLEDGE_ITEM_STATUSES', () => {
  it('contains published and archived', () => {
    expect(KNOWLEDGE_ITEM_STATUSES).toHaveLength(2);
    expect(KNOWLEDGE_ITEM_STATUSES).toContain('published');
    expect(KNOWLEDGE_ITEM_STATUSES).toContain('archived');
  });
});

describe('WIKI_SYNC_STATUSES', () => {
  it('contains all 4 statuses', () => {
    expect(WIKI_SYNC_STATUSES).toHaveLength(4);
    for (const s of ['committed', 'push_pending', 'synced', 'push_failed']) {
      expect(WIKI_SYNC_STATUSES).toContain(s);
    }
  });
});

describe('KNOWLEDGE_CATEGORIES', () => {
  it('has exactly the 6 iRacing knowledge categories', () => {
    const keys = Object.keys(KNOWLEDGE_CATEGORIES);
    expect(keys).toEqual([
      'official-racing',
      'getting-started',
      'driving-technique',
      'car-setup',
      'cars-and-tracks',
      'hardware-and-software',
    ]);
  });

  it('covers official schedules, rules, beginner, driving, setup and equipment topics', () => {
    expect(KNOWLEDGE_CATEGORIES['official-racing']).toContain('schedule-and-season');
    expect(KNOWLEDGE_CATEGORIES['official-racing']).toContain('sporting-code');
    expect(KNOWLEDGE_CATEGORIES['getting-started']).toContain('first-race');
    expect(KNOWLEDGE_CATEGORIES['driving-technique']).toEqual([
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
    ]);
    expect(KNOWLEDGE_CATEGORIES['car-setup']).toContain('aerodynamics');
    expect(KNOWLEDGE_CATEGORIES['cars-and-tracks']).toContain('track-guide');
    expect(KNOWLEDGE_CATEGORIES['hardware-and-software']).toContain('force-feedback');
  });
});

describe('RATE_LIMIT_SCOPES', () => {
  it('contains global, role and user', () => {
    expect(RATE_LIMIT_SCOPES).toHaveLength(3);
    expect(RATE_LIMIT_SCOPES).toContain('global');
    expect(RATE_LIMIT_SCOPES).toContain('role');
    expect(RATE_LIMIT_SCOPES).toContain('user');
  });
});

describe('FEEDBACK_RATINGS', () => {
  it('contains up and down', () => {
    expect(FEEDBACK_RATINGS).toHaveLength(2);
    expect(FEEDBACK_RATINGS).toContain('up');
    expect(FEEDBACK_RATINGS).toContain('down');
  });
});

describe('ERROR_CODES', () => {
  it('covers exactly 23 error codes including the session concurrency conflict', () => {
    const keys = Object.keys(ERROR_CODES);
    expect(keys).toHaveLength(23);
    expect(ERROR_CODES.SESSION_BUSY).toEqual({ http: 409, code: 'SESSION_BUSY' });
  });

  it('each error code has http status and code string', () => {
    for (const [key, val] of Object.entries(ERROR_CODES)) {
      expect(typeof val.http).toBe('number');
      expect(val.http).toBeGreaterThan(0);
      expect(val.code).toBe(key);
    }
  });

  it('maps 400-level errors correctly', () => {
    // 400
    expect(ERROR_CODES.VALIDATION_ERROR.http).toBe(400);
    // 401
    expect(ERROR_CODES.UNAUTHENTICATED.http).toBe(401);
    expect(ERROR_CODES.TOKEN_REUSED.http).toBe(401);
    // 403
    expect(ERROR_CODES.FORBIDDEN.http).toBe(403);
    expect(ERROR_CODES.ACCOUNT_PENDING.http).toBe(403);
    expect(ERROR_CODES.ACCOUNT_DISABLED.http).toBe(403);
    // 404
    expect(ERROR_CODES.NOT_FOUND.http).toBe(404);
    // 409
    expect(ERROR_CODES.CONFLICT.http).toBe(409);
    expect(ERROR_CODES.DUPLICATE_SOURCE.http).toBe(409);
    expect(ERROR_CODES.INVALID_STATE.http).toBe(409);
    // 413
    expect(ERROR_CODES.FILE_TOO_LARGE.http).toBe(413);
    expect(ERROR_CODES.CONTENT_TOO_LARGE.http).toBe(413);
    // 415
    expect(ERROR_CODES.UNSUPPORTED_MEDIA_TYPE.http).toBe(415);
    expect(ERROR_CODES.PDF_OCR_REQUIRED.http).toBe(415);
    // 422
    expect(ERROR_CODES.EXTRACTION_FAILED.http).toBe(422);
    expect(ERROR_CODES.DRAFT_INVALID.http).toBe(422);
    // 429
    expect(ERROR_CODES.RATE_LIMITED.http).toBe(429);
  });

  it('maps 500-level errors correctly', () => {
    // 502
    expect(ERROR_CODES.AGENT_UNAVAILABLE.http).toBe(502);
    expect(ERROR_CODES.WEB_FETCH_FAILED.http).toBe(502);
    // 503
    expect(ERROR_CODES.AGENT_AUTH_EXPIRED.http).toBe(503);
    expect(ERROR_CODES.SERVICE_NOT_READY.http).toBe(503);
  });
});
