import { NextResponse } from 'next/server';
import { AuthError } from '../auth/session';

export function errorResponse(error: unknown, fallbackStatus = 500) {
  const status = error instanceof AuthError ? error.status : fallbackStatus;
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status });
}
