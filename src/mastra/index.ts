import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { PinoLogger } from '@mastra/loggers';
import { vioscopeAgent } from './agents/vioscope';

const logLevel = ['debug', 'info', 'warn', 'error'] as const;
const configuredLogLevel = logLevel.find((level) => level === process.env.LOG_LEVEL) || 'info';
const storagePath = process.env.DATASTORE_DIR
  ? resolve(process.cwd(), process.env.DATASTORE_DIR, 'runtime', 'mastra.db')
  : resolve(tmpdir(), 'vioscope-agent', 'mastra.db');

if (!process.env.MASTRA_STORAGE_URL) {
  mkdirSync(dirname(storagePath), { recursive: true });
}

export const mastra = new Mastra({
  agents: { vioscopeAgent },
  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: process.env.MASTRA_STORAGE_URL || `file:${storagePath}`,
  }),
  logger: new PinoLogger({
    name: 'VioScope',
    level: configuredLogLevel,
  }),
});
