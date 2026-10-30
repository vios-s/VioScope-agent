import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPostgresClient, closePostgresPools } from '../src/mastra/db/postgres';
import { evidenceSourceLabel, meetingSuggestionContext, themeStagePrompt, validateThemeSuggestion } from '../src/mastra/theme-meetings/guidance';

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
  for (const name of ['owner', 'outsider', 'reviewer', 'principal']) await db.pool.query("INSERT INTO users(id,username,display_name,email,role,provisioning_status,password_reset_required) VALUES($1,$2,$2,$3,'member','active',false)", [randomUUID(), name, name + '@example.test']);
  await db.pool.query("UPDATE users SET role='pi' WHERE username='principal'");
  const owner = (await users.getUserByUsername('owner'))!, outsider = (await users.getUserByUsername('outsider'))!;
  const projects = await import('../src/mastra/db/projects');
  const project = await projects.createProject({ title: 'Synthetic PoC', piUsername: 'principal', pdraUsername: 'reviewer', ownerUsername: 'owner', stage: 2, blocker: 'High variance across seeds.', target: 'Repeat the comparison.', todos: [{ text: 'Run three more seeds on Dataset Y.' }] }, owner);
  const context = meetingSuggestionContext(project);
  const valid = { slot: 'deep_dive', rationale: 'Discuss the uncertain PoC signal.', progress: '- The Signal: No validated result recorded.\n- The Risk: High variance across seeds.', questions: '- Which repeat comparison would resolve the uncertainty?', evidence: [{ source: 'blocker', quote: 'High variance across seeds.' }] };
  assert.equal(validateThemeSuggestion(valid, context).slot, 'deep_dive');
  assert.throws(() => validateThemeSuggestion({ ...valid, evidence: [{ source: 'blocker', quote: 'Invented result' }] }, context), /absent/);
  // Planned actions are citable (task:<id>); title and stage progress are context only.
  const taskKey = Object.keys(context.sources).find((key) => key.startsWith('task:'))!;
  assert.ok(taskKey && context.sources[taskKey] === 'Run three more seeds on Dataset Y.');
  assert.equal('title' in context.sources || 'stageProgress' in context.sources, false);
  assert.equal(validateThemeSuggestion({ ...valid, evidence: [{ source: taskKey, quote: 'three more seeds' }] }, context).evidence.length, 1);
  assert.deepEqual(validateThemeSuggestion({ ...valid, evidence: [...valid.evidence, { source: 'title', quote: 'Synthetic PoC' }, { source: 'blocker', quote: 'Invented' }] }, context).evidence, valid.evidence, 'Invalid entries are dropped when a valid one remains.');
  assert.deepEqual([taskKey, 'blocker', 'submissionDeadline', `progress:x`].map(evidenceSourceLabel), ['Planned action', 'Blocker', 'Submission deadline', 'Progress update']);
  assert.match(themeStagePrompt(4), /Deep Dive is mandatory/); assert.match(themeStagePrompt(4), /Reviewer 2/);
  assert.match(themeStagePrompt(3), /Track B/); assert.match(themeStagePrompt(3), /Track A/); assert.match(themeStagePrompt(1), /Pain Point/);
  assert.equal(meetingSuggestionContext({ ...project, track: 'A' }).track, 'A', 'The project track reaches the model.');
  const han = String.fromCodePoint(0x8bf7, 0x7528, 0x4e2d, 0x6587, 0x56de, 0x7b54, 0x8fd9, 0x4e2a, 0x95ee, 0x9898);
  assert.throws(() => validateThemeSuggestion({ ...valid, rationale: han }, context), /not written in English/);
  assert.throws(() => validateThemeSuggestion({ ...valid, progress: '- ' + 'word '.repeat(80) }, context), /75-word/);
  const boundary = { ...valid, rationale: 'Review.', progress: '- ' + 'word '.repeat(73), questions: '' };
  assert.doesNotThrow(() => validateThemeSuggestion(boundary, context), '75 words across the whole suggestion are allowed.');
  assert.throws(() => validateThemeSuggestion({ ...boundary, questions: 'Why?' }, context), /75-word/, 'Questions count towards the same budget.');
  assert.throws(() => validateThemeSuggestion({ ...valid, rationale: 'word '.repeat(75) }, context), /75-word/);
  assert.throws(() => validateThemeSuggestion({ ...valid, questions: 'word '.repeat(75) }, context), /75-word/);
  const quote = 'recorded '.repeat(90).trim();
  assert.equal(validateThemeSuggestion({ ...boundary, evidence: [{ source: 'blocker', quote }] }, { ...context, sources: { blocker: quote } }).evidence[0].quote, quote, 'Evidence stays verbatim outside the prose budget.');
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
    assert.ok(request.includes('Citable evidence source keys') && request.includes('task:') && request.includes('Discussant questions'));
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
  const invalidBefore = calls;
  const invalid = await POST(request()); assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /absent from the project/);
  assert.equal(calls - invalidBefore, 2, 'Evidence mismatches get exactly one automatic retry.');
  // Over-long drafts get exactly one automatic retry with an explicit shorter limit; quotes are never truncated.
  const long = { ...valid, progress: '- ' + 'word '.repeat(80) };
  let answers: unknown[] = [long, valid], retryPrompts: string[] = [];
  const plainFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => { answer = answers.shift(); retryPrompts.push(String(init?.body || '')); return plainFetch(input, init); };
  const retried = await POST(request()); assert.equal(retried.status, 200, await retried.clone().text());
  assert.deepEqual((await retried.json()).suggestion, valid);
  assert.equal(retryPrompts.length, 2); assert.ok(!retryPrompts[0].includes('RETRY') && /at most 50 words/.test(retryPrompts[1]));
  answers = [{ ...valid, rationale: 'word '.repeat(75) }, valid]; retryPrompts = [];
  const rationaleRetry = await POST(request()); assert.equal(rationaleRetry.status, 200, await rationaleRetry.clone().text());
  assert.equal(retryPrompts.length, 2); assert.match(retryPrompts[1], /rationale, progress and questions/);
  // An evidence mismatch retries once with the allowed source keys listed; the corrected answer is accepted.
  answers = [{ ...valid, evidence: [{ source: 'Blocker', quote: 'High variance across seeds.' }] }, valid]; retryPrompts = [];
  const evidenceRetry = await POST(request()); assert.equal(evidenceRetry.status, 200, await evidenceRetry.clone().text());
  assert.ok(/Use only these source keys: .*blocker/.test(retryPrompts[1]));
  // A non-English answer is regenerated once with an explicit English instruction.
  answers = [{ ...valid, rationale: han }, valid]; retryPrompts = [];
  const languageRetry = await POST(request()); assert.equal(languageRetry.status, 200, await languageRetry.clone().text());
  assert.ok(/formal English only/.test(retryPrompts[1]));
  answers = [long, long]; retryPrompts = [];
  const tooLong = await POST(request()); assert.equal(tooLong.status, 400);
  assert.match((await tooLong.json()).error, /longer than 75 words after a shorter retry/); assert.equal(retryPrompts.length, 2);
  globalThis.fetch = plainFetch;
  answer = valid;
  changeDuringGeneration = async () => { await projects.updateProject(project.id, { stage: 3 }, owner); };
  assert.equal((await POST(request())).status, 409, 'Discard advice if the project changes during generation.');
  changeDuringGeneration = undefined;
  await projects.updateProject(project.id, { lifecycle: 'paused' }, owner);
  const before = calls;
  assert.equal((await POST(request())).status, 400); assert.equal(calls, before);
  console.log('Meeting AI checks passed: stage-aware project evidence (tasks citable, title excluded), validated quotes with one retry, English retry, word/bullet limits, permissions, stale results, no project advancement. Simulated model; disposable DB.');
} finally {
  globalThis.fetch = originalFetch;
  await closePostgresPools();
  if (created) await source.pool.query(`DROP DATABASE "${database}"`);
  await source.pool.end(); await rm(directory, { recursive: true, force: true });
}
