export {};

const [dbPath, snapshotPath, sourceName, sourceUrl] = process.argv.slice(2);
if (!dbPath || !snapshotPath || !sourceName || !sourceUrl) {
  throw new Error('missing Web source concurrency worker argument');
}
const workerSourceName = sourceName;
const workerSourceUrl = sourceUrl;

process.env.DATABASE_PATH = dbPath;
process.env.WEB_KNOWLEDGE_SOURCES_SNAPSHOT_PATH = snapshotPath;

async function main(): Promise<void> {
  const { createWebSource } = await import('@/modules/web-sources/service');
  createWebSource(
    {
      name: workerSourceName,
      scopeType: 'domain',
      url: workerSourceUrl,
      sourceLevel: 'official',
      enabled: true,
    },
    'admin-1',
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
