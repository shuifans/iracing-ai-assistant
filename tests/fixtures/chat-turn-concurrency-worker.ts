const [databasePath, sessionId, content] = process.argv.slice(2);
if (!databasePath || !sessionId || !content) {
  throw new Error('missing chat turn concurrency worker argument');
}
const targetSessionId = sessionId;
const targetContent = content;

process.env.DATABASE_PATH = databasePath;

async function main(): Promise<void> {
  const [{ createChatTurn }, { AppError }] = await Promise.all([
    import('@/modules/chat/repository'),
    import('@/lib/errors'),
  ]);
  try {
    createChatTurn(targetSessionId, 'owner', targetContent);
    process.stdout.write('success');
  } catch (error) {
    if (error instanceof AppError && error.code === 'SESSION_BUSY') {
      process.stdout.write('SESSION_BUSY');
      return;
    }
    throw error;
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.name : typeof error);
  process.exitCode = 1;
});

export {};
