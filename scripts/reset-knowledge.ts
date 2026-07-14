import { closeDb } from '@/db/client';
import { resetKnowledgeDomain } from '@/modules/knowledge/reset';

const confirm = process.argv.includes('--confirm-reset-knowledge');
const dataRoot = process.env.DATA_ROOT || './data';

try {
  resetKnowledgeDomain({ dataRoot, confirm });
  console.log(`Knowledge domain reset complete: ${dataRoot}`);
} finally {
  closeDb();
}
