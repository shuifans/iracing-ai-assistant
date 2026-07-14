import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function major(version: string | undefined): number {
  const match = version?.match(/(\d+)/);
  if (!match) throw new Error(`Cannot determine dependency major from ${String(version)}`);
  return Number(match[1]);
}

describe('runtime dependency security baseline', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
  ) as PackageManifest;

  it('uses a supported Next.js line with compatible React and lint packages', () => {
    const nextMajor = major(manifest.dependencies?.next);

    expect(nextMajor).toBeGreaterThanOrEqual(15);
    expect(major(manifest.devDependencies?.['eslint-config-next'])).toBe(nextMajor);
    expect(major(manifest.dependencies?.react)).toBeGreaterThanOrEqual(19);
    expect(major(manifest.dependencies?.['react-dom'])).toBe(
      major(manifest.dependencies?.react),
    );
  });

  it('does not depend on the vulnerable npm-registry xlsx release', () => {
    expect(manifest.dependencies).not.toHaveProperty('xlsx');
    expect(manifest.dependencies).toHaveProperty('read-excel-file');
  });
});
