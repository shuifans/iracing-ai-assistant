/**
 * Returns current UTC time as ISO 8601 string.
 */
export function utcNow(): string {
  return new Date().toISOString();
}

/**
 * Formats a UTC ISO 8601 string for display in Asia/Shanghai timezone.
 * Reserved for future UI use — not called in Work Package A.
 */
export function formatForDisplay(isoUtc: string): string {
  const date = new Date(isoUtc);
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
