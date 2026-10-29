import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthError } from '../auth/session';

type Issue = ZodError['issues'][number];

/** First concrete issue; for a union, the branch with the fewest issues is the one the client most likely meant. */
function firstIssue(issues: readonly Issue[]): Issue | undefined {
  const issue = issues[0];
  if (issue?.code !== 'invalid_union' || !issue.errors.length) return issue;
  return firstIssue([...issue.errors].sort((a, b) => a.length - b.length)[0]);
}
/** Schema-authored messages are shown as written; zod's generic messages become a short field hint, never raw JSON. */
export function validationMessage(error: ZodError) {
  const issue = firstIssue(error.issues);
  if (!issue) return 'The request is invalid. Check the form and try again.';
  if (!/^(Invalid|Too (small|big)|Unrecognized|Expected)/.test(issue.message)) return issue.message;
  const field = issue.path.filter(part => typeof part === 'string').at(-1);
  const label = typeof field === 'string' ? field.replace(/([A-Z])/g, ' $1').toLowerCase() : '';
  return label ? `Check the ${label} field and try again.` : 'The request is invalid. Check the form and try again.';
}

export function errorResponse(error: unknown, fallbackStatus = 500) {
  const status = error instanceof AuthError ? error.status : fallbackStatus;
  const message = error instanceof ZodError ? validationMessage(error) : error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status });
}
