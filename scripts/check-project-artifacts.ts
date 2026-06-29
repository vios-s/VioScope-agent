import 'dotenv/config';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { rm, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import JSZip from 'jszip';
import { createSessionToken, sessionCookieName } from '../src/mastra/auth/session';
import { createPostgresClient } from '../src/mastra/db/postgres';
import { getUserByUsername, upsertLocalUser, type AuthUser } from '../src/mastra/db/users';

const stamp = Date.now();
const slug = `educational-agent-with-memory-${stamp}`;
const username = `artifact.owner.${stamp}`;
const checkDir = resolve(process.cwd(), '.local/checks/project-artifacts');

function cookieFor(user: AuthUser): string {
  return `${sessionCookieName}=${createSessionToken(user)}`;
}

function jsonRequest(path: string, body: unknown, user: AuthUser, method = 'POST'): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: cookieFor(user),
    },
    body: JSON.stringify(body),
  });
}

function multipartRequest(path: string, formData: FormData, user: AuthUser): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { cookie: cookieFor(user) },
    body: formData,
  });
}

function getRequest(path: string, user: AuthUser): Request {
  return new Request(`http://localhost${path}`, {
    headers: { cookie: cookieFor(user) },
  });
}

function emptyRequest(path: string, user: AuthUser, method: string): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { cookie: cookieFor(user) },
  });
}

async function bodyOf<T>(response: Response): Promise<T & { error?: string }> {
  return (await response.json()) as T & { error?: string };
}

function projectContext(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

function artifactContext(artifactId: string) {
  return { params: Promise.resolve({ artifactId }) };
}

async function seedUser(): Promise<AuthUser> {
  await upsertLocalUser({
    username,
    email: `${username}@example.test`,
    password: 'ArtifactCheck1!',
    role: 'member',
    displayName: username,
    source: 'project_artifact_check',
  });
  const user = await getUserByUsername(username);
  assert.ok(user, 'Expected artifact check user to exist.');
  return user;
}

async function cleanup(paths: string[] = []) {
  const postgres = createPostgresClient('project-artifact-check-cleanup');
  try {
    await postgres.pool.query('DELETE FROM project_records WHERE slug = $1', [slug]).catch(() => undefined);
    await postgres.pool
      .query(
        `
          DELETE FROM audit_log
          WHERE actor_username = $1
            OR metadata::text LIKE $2
        `,
        [username, `%${slug}%`],
      )
      .catch(() => undefined);
    await postgres.pool.query('DELETE FROM users WHERE username = $1', [username]).catch(() => undefined);
  } finally {
    await postgres.disconnect();
  }

  for (const path of paths) {
    await rm(path, { recursive: true, force: true }).catch(() => undefined);
    await rm(`${path}.extracted`, { recursive: true, force: true }).catch(() => undefined);
    await rm(dirname(dirname(path)), { recursive: true, force: true }).catch(() => undefined);
  }
  await rm(checkDir, { recursive: true, force: true }).catch(() => undefined);
}

async function makeDocx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types" />');
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function makePptx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types" />');
  zip.file(
    'ppt/slides/slide1.xml',
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function makeZip(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('notes.md', '# Educational Agent with Memory\n\nEvaluation plan uses retrieval memory, learner profile memory, and reflective tutoring notes.');
  zip.file('proposal.txt', 'The system stores long-term memory summaries and tests whether students receive better hints over time.');
  return zip.generateAsync({ type: 'nodebuffer' });
}

function makePdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  return Buffer.from(
    `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length ${stream.length} >> stream
${stream}
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R >>
%%EOF`,
    'utf8',
  );
}

async function writeMockFile(fileName: string, buffer: Buffer) {
  await mkdir(checkDir, { recursive: true });
  const path = resolve(checkDir, fileName);
  await writeFile(path, buffer);
  return path;
}

function filePart(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

async function uploadArtifact(
  updatesRoute: typeof import('../app/api/projects/[projectId]/updates/route'),
  projectId: string,
  user: AuthUser,
  fileName: string,
  buffer: Buffer,
) {
  await writeMockFile(fileName, buffer);
  const formData = new FormData();
  formData.set('type', 'artifact');
  formData.set('date', '2026-06-22');
  formData.set('text', `Uploaded ${fileName} for Educational Agent with Memory.`);
  formData.set('artifactFile', new File([filePart(buffer)], fileName));

  const response = await updatesRoute.POST(multipartRequest(`/api/projects/${projectId}/updates`, formData, user), projectContext(projectId));
  const body = await bodyOf<{ project?: any; artifactDigest?: any }>(response);
  assert.equal(response.status, 200, body.error || `${fileName} upload failed.`);
  assert.ok(body.artifactDigest?.summaryLength > 20, `${fileName} should have an auto digest.`);
  const artifact = body.project?.artifacts?.find((item: any) => item.title === fileName && item.isCurrent);
  assert.ok(artifact, `${fileName} should be recorded as current artifact.`);
  assert.ok(artifact.summary?.length > 20, `${fileName} artifact summary should be stored.`);
  assert.ok(artifact.path && existsSync(artifact.path), `${fileName} should be stored on disk.`);
  if (process.env.DATASTORE_DIR) {
    assert.ok(
      artifact.path.includes(`/users/${username}/projects/${slug}/`),
      `${fileName} should be stored under the project watch-path folder.`,
    );
  }
  return { artifact, digest: body.artifactDigest };
}

async function main() {
  await cleanup();
  const user = await seedUser();
  const projectsRoute = await import('../app/api/projects/route');
  const updatesRoute = await import('../app/api/projects/[projectId]/updates/route');
  const artifactRoute = await import('../app/api/project-artifacts/[artifactId]/route');
  const digestRoute = await import('../app/api/project-artifacts/[artifactId]/digest/route');
  const downloadRoute = await import('../app/api/project-artifacts/[artifactId]/download/route');
  const createdPaths: string[] = [];

  try {
    const createResponse = await projectsRoute.POST(jsonRequest('/api/projects', {
      project: slug,
      title: 'Educational Agent with Memory',
      ownerUsername: user.username,
      collaborators: ['External Education Partner'],
      track: 'A',
      stage: 2,
      status: 'on_track',
      lifecycle: 'active',
      target: 'Prototype a tutoring agent that remembers learner goals.',
      venue: 'AIED',
      submissionDeadline: '2026-09-30',
    }, user));
    const createBody = await bodyOf<{ project?: any }>(createResponse);
    assert.equal(createResponse.status, 200, createBody.error || 'Project create failed.');
    const projectId = createBody.project.id;

    const unsafeArtifactResponse = await updatesRoute.POST(
      jsonRequest(`/api/projects/${projectId}/updates`, {
        type: 'artifact',
        text: 'Linked an external artifact path that must not be read as a server-local file.',
        artifact: {
          title: 'unsafe-local-path.txt',
          kind: 'document',
          path: '/etc/passwd',
          summary: 'External path reference for artifact safety check.',
        },
      }, user),
      projectContext(projectId),
    );
    const unsafeArtifactBody = await bodyOf<{ project?: any }>(unsafeArtifactResponse);
    assert.equal(unsafeArtifactResponse.status, 200, unsafeArtifactBody.error || 'Unsafe-path artifact setup failed.');
    const unsafeArtifact = unsafeArtifactBody.project?.artifacts?.find((item: any) => item.title === 'unsafe-local-path.txt');
    assert.ok(unsafeArtifact?.id, 'Unsafe-path artifact should be recorded as metadata.');
    const unsafeDownload = await downloadRoute.GET(
      getRequest(`/api/project-artifacts/${unsafeArtifact.id}/download`, user),
      artifactContext(unsafeArtifact.id),
    );
    assert.notEqual(unsafeDownload.status, 200, 'Download must not read arbitrary server-local artifact paths.');
    const unsafeDigest = await digestRoute.POST(
      emptyRequest(`/api/project-artifacts/${unsafeArtifact.id}/digest`, user, 'POST'),
      artifactContext(unsafeArtifact.id),
    );
    assert.notEqual(unsafeDigest.status, 200, 'Digest must not read arbitrary server-local artifact paths.');

    const docx = await uploadArtifact(
      updatesRoute,
      projectId,
      user,
      'memory-agent-overview.docx',
      await makeDocx('Educational Agent with Memory combines student profile memory, retrieval memory, and weekly learning reflections.'),
    );
    const pptx = await uploadArtifact(
      updatesRoute,
      projectId,
      user,
      'memory-agent-demo.pptx',
      await makePptx('Demo slides describe memory states, tutor interventions, and evaluation metrics for learning gains.'),
    );
    const zip = await uploadArtifact(updatesRoute, projectId, user, 'memory-agent-pack.zip', await makeZip());
    const pdf = await uploadArtifact(
      updatesRoute,
      projectId,
      user,
      'memory-agent-evaluation.pdf',
      makePdf('Educational Agent with Memory PDF reports learner memory evaluation and tutor feedback metrics.'),
    );

    createdPaths.push(docx.artifact.path, pptx.artifact.path, zip.artifact.path, pdf.artifact.path);
    assert.ok(existsSync(`${zip.artifact.path}.extracted/notes.md`), 'Zip upload should be extracted.');
    assert.ok(existsSync(`${zip.artifact.path}.extracted/proposal.txt`), 'Zip upload should extract every safe file.');

    const downloadResponse = await downloadRoute.GET(
      getRequest(`/api/project-artifacts/${pdf.artifact.id}/download`, user),
      artifactContext(pdf.artifact.id),
    );
    assert.equal(downloadResponse.status, 200, 'Artifact download should succeed.');
    assert.ok((await downloadResponse.arrayBuffer()).byteLength > 100, 'Downloaded artifact should contain bytes.');

    const digestResponse = await digestRoute.POST(
      emptyRequest(`/api/project-artifacts/${docx.artifact.id}/digest`, user, 'POST'),
      artifactContext(docx.artifact.id),
    );
    const digestBody = await bodyOf<{ project?: any; artifactDigest?: any }>(digestResponse);
    assert.equal(digestResponse.status, 200, digestBody.error || 'Manual digest should succeed.');
    assert.ok(digestBody.artifactDigest?.summaryLength > 20, 'Manual digest should return a stored summary.');

    const deleteResponse = await artifactRoute.DELETE(
      emptyRequest(`/api/project-artifacts/${pptx.artifact.id}`, user, 'DELETE'),
      artifactContext(pptx.artifact.id),
    );
    const deleteBody = await bodyOf<{ project?: any }>(deleteResponse);
    assert.equal(deleteResponse.status, 200, deleteBody.error || 'Artifact remove should succeed.');
    assert.equal(
      deleteBody.project?.artifacts?.some((artifact: any) => artifact.id === pptx.artifact.id),
      false,
      'Removed artifact should disappear from project artifacts.',
    );

    const tooLarge = Buffer.alloc(20 * 1024 * 1024 + 1, 'a');
    const largeFormData = new FormData();
    largeFormData.set('type', 'artifact');
    largeFormData.set('text', 'This should fail before storage.');
    largeFormData.set('artifactFile', new File([filePart(tooLarge)], 'too-large.txt'));
    const largeResponse = await updatesRoute.POST(
      multipartRequest(`/api/projects/${projectId}/updates`, largeFormData, user),
      projectContext(projectId),
    );
    assert.equal(largeResponse.status, 400, 'Files over 20 MB should be rejected.');

    const postgres = createPostgresClient('project-artifact-check-audit');
    try {
      const uploadAuditResult = await postgres.pool.query<{ count: string }>(
        `
          SELECT count(*)::text
          FROM audit_log
          WHERE actor_username = $1
            AND action = 'project.update_add'
            AND metadata->>'artifactDigestSource' IS NOT NULL
        `,
        [username],
      );
      assert.equal(Number(uploadAuditResult.rows[0]?.count || 0), 4, 'Artifact uploads should write digest audit metadata.');
      const actionResult = await postgres.pool.query<{ action: string }>(
        `
          SELECT DISTINCT action
          FROM audit_log
          WHERE actor_username = $1
            AND action IN ('project.artifact_download', 'project.artifact_digest', 'project.artifact_remove')
        `,
        [username],
      );
      const actions = new Set(actionResult.rows.map((row: { action: string }) => row.action));
      for (const action of ['project.artifact_download', 'project.artifact_digest', 'project.artifact_remove']) {
        assert.ok(actions.has(action), `Expected audit action ${action}.`);
      }
    } finally {
      await postgres.disconnect();
    }

    console.log('Project artifact upload/digest check passed.');
    console.log(
      JSON.stringify(
        {
          title: 'Educational Agent with Memory',
          uploads: [
            { file: docx.artifact.title, kind: docx.artifact.kind, digestSource: docx.digest.source },
            { file: pptx.artifact.title, kind: pptx.artifact.kind, digestSource: pptx.digest.source },
            { file: pdf.artifact.title, kind: pdf.artifact.kind, digestSource: pdf.digest.source },
            { file: zip.artifact.title, kind: zip.artifact.kind, digestSource: zip.digest.source, extractedFileCount: zip.digest.extractedFileCount },
          ],
          lifecycle: ['download', 'manual_digest', 'remove', '20mb_limit'].join(', '),
        },
        null,
        2,
      ),
    );
  } finally {
    await cleanup(createdPaths);
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await cleanup().catch(() => undefined);
  process.exitCode = 1;
});
