import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPostgresClient, closePostgresPools } from '../src/mastra/db/postgres';
import { meetingSuggestionContext, validateThemeSuggestion } from '../src/mastra/theme-meetings/guidance';

const original = process.env.DATABASE_URL!;
const source = createPostgresClient('theme-suggestion-test');
const database = 'theme_suggestion_' + randomUUID().replaceAll('-', '');
const directory = await mkdtemp(join(tmpdir(), 'theme-suggestion-'));
const originalFetch = globalThis.fetch;
let created = false, calls = 0, changeDuringGeneration: (() => Promise<void>) | undefined;
let answer: unknown;
try {
  await source.pool.query(`CREATE DATABASE "${database}"`); created = true;
  const url = new URL(original); url.pathname = '/' + database;
  Object.assign(process.env, { DATABASE_URL: url.toString(), DATASTORE_DIR: directory, AUTH_SECRET: 'synthetic-theme-suggestion', VIOSCOPE_RUNTIME_CONFIG_CACHE_PATH: join(directory, 'runtime.json') });
  const users = await import('../src/mastra/db/users'); await users.ensureUsersTable();
  const db = createPostgresClient();
  for (const name of ['owner', 'outsider']) await db.pool.query("INSERT INTO users(id,username,display_name,email,role,provisioning_status,password_reset_required) VALUES($1,$2,$2,$3,'member','active',false)", [randomUUID(), name, name + '@example.test']);
  const owner = (await users.getUserByUsername('owner'))!, outsider = (await users.getUserByUsername('outsider'))!;
  const projects = await import('../src/mastra/db/projects');
  const project = await projects.createProject({ title: 'Synthetic PoC', ownerUsername: 'owner', stage: 2, blocker: 'High variance across seeds.', target: 'Repeat the comparison.' }, owner);
  const context = meetingSuggestionContext(project);
  const valid = { slot: 'deep_dive', rationale: 'Discuss the uncertain PoC signal.', progress: '- The Signal: No validated result recorded.\n- The Risk: High variance across seeds.', questions: '- Which repeat comparison would resolve the uncertainty?', evidence: [{ source: 'blocker', quote: 'High variance across seeds.' }] };
  assert.equal(validateThemeSuggestion(valid, context).slot, 'deep_dive');
  assert.throws(() => validateThemeSuggestion({ ...valid, evidence: [{ source: 'blocker', quote: 'Invented result' }] }, context), /absent/);
  assert.throws(() => validateThemeSuggestion({ ...valid, progress: '- ' + 'word '.repeat(80) }, context), /75-word/);
  for (const marker of ['-', '*', '+', '•', '●', '–', '—', '']) {
    const progress = `  ${marker} The Signal: No validated result recorded.\r\n\r\n  ${marker} The Risk: High variance across seeds.  `;
    assert.equal(validateThemeSuggestion({ ...valid, progress }, context).progress, valid.progress);
  }
  assert.throws(() => validateThemeSuggestion({ ...valid, progress: '● ' + 'word '.repeat(80) }, context), /75-word/);
  answer = { ...valid, progress: valid.progress.replaceAll('- ', '● ').replace('\n', '\r\n\r\n') };
  globalThis.fetch = async (_input, init) => {
    calls++;
    const request = String(init?.body || '');
    assert.ok(request.includes('PoC Results') && request.includes('High variance across seeds.') && request.includes('PROJECT_DATA_JSON'));
    if (changeDuringGeneration) await changeDuringGeneration();
    return new Response(JSON.stringify({ id: 'resp_synthetic', created_at: 1, model: 'synthetic', status: 'completed',
      output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(answer), annotations: [] }] }],
      usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } }), { headers: { 'content-type': 'application/json' } });
  };
  const { POST } = await import('../app/api/theme-meetings/suggestion/route');
  const { sessionCookieName, createSessionToken } = await import('../src/mastra/auth/session');
  const request = (user = owner, body: unknown = { projectId: project.id }) => new Request('http://localhost/api/theme-meetings/suggestion', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `${sessionCookieName}=${createSessionToken(user)}` }, body: JSON.stringify(body) });
  assert.equal((await POST(new Request('http://localhost/api/theme-meetings/suggestion', { method: 'POST' }))).status, 401);
  assert.notEqual((await POST(request(outsider))).status, 200);
  assert.equal((await POST(request(owner, { projectId: project.id, stage: 5 }))).status, 400);
  assert.equal(calls, 0, 'Unauthorized or forged context cannot trigger a model call.');
  const response = await POST(request()); assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual((await response.json()).suggestion, valid);
  assert.equal((await projects.getProjectForUser(project.id, owner)).stage, 2, 'Suggestions do not advance the project.');
  answer = { ...valid, evidence: [{ source: 'blocker', quote: 'Invented result' }] };
  assert.equal((await POST(request())).status, 400);
  answer = valid;
  changeDuringGeneration = async () => { await projects.updateProject(project.id, { stage: 3 }, owner); };
  assert.equal((await POST(request())).status, 409, 'Discard advice if the project changes during generation.');
  changeDuringGeneration = undefined;
  await projects.updateProject(project.id, { lifecycle: 'paused' }, owner);
  const before = calls;
  assert.equal((await POST(request())).status, 400); assert.equal(calls, before);
  console.log('Meeting AI checks passed: stage-aware project evidence, validated quotes, word/bullet limits, permissions, stale results, no project advancement. Simulated model; disposable DB.');
} finally {
  globalThis.fetch = originalFetch;
  await closePostgresPools();
  if (created) await source.pool.query(`DROP DATABASE "${database}"`);
  await source.pool.end(); await rm(directory, { recursive: true, force: true });
}
