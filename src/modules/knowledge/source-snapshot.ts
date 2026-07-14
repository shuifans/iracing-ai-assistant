import * as fs from 'fs';
import * as path from 'path';
import { generateId } from '@/lib/uuid';

export function getSourceSnapshotPath(dataRoot: string, sourceId: string): string {
  return path.join(dataRoot, 'extracted', `${sourceId}.txt`);
}

export function writeSourceSnapshot(pathname: string, content: string): void {
  if (fs.existsSync(pathname)) {
    throw new Error(`Source snapshot already exists: ${pathname}`);
  }

  fs.mkdirSync(path.dirname(pathname), { recursive: true });
  const temporaryPath = `${pathname}.${process.pid}.${generateId()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, content, { encoding: 'utf-8', flag: 'wx' });
    fs.linkSync(temporaryPath, pathname);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}
