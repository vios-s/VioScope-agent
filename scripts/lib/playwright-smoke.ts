import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

export { chromium };

export async function dismissWelcomeIfVisible(page: any) {
  const dialog = page.locator('.welcome-dialog');
  if (!(await dialog.isVisible().catch(() => false))) return;
  await dialog.getByLabel('Close welcome message').click();
  await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
}

export async function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address?.port) resolvePort(address.port);
        else reject(new Error('Could not allocate a free port.'));
      });
    });
  });
}

export function startNextServer({
  port,
  mode = 'dev',
  env = {},
}: {
  port: number;
  mode?: 'dev' | 'start';
  env?: Record<string, string | undefined>;
}): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), mode, '-p', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
      ...env,
    },
  });
}

export async function waitForServer(server: ChildProcessWithoutNullStreams, baseUrl: string, attempts = 100) {
  let output = '';
  server.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Next test server exited early:\n${output}`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // keep polling
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Next test server did not start:\n${output}`);
}

export async function stopServer(server: ChildProcessWithoutNullStreams | null) {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => server.once('exit', resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 3000)),
  ]);
}
