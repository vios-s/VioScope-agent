import 'dotenv/config';
import { pruneAuditLogs } from '../src/mastra/db/audit-log';

async function main() {
  const deleted = await pruneAuditLogs();
  console.log(JSON.stringify({ deleted }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
