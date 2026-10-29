import 'dotenv/config';
import { NextResponse } from 'next/server';
import { requireSessionUser } from '../../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../../src/mastra/http/error-response';
import { getUserById } from '../../../../../src/mastra/db/users';

export const runtime = 'nodejs';

// Raster formats only: never serve SVG or HTML from user-supplied data.
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    await requireSessionUser(request);
    const { userId } = await params;
    if (!uuidPattern.test(userId)) return new NextResponse(null, { status: 404 });
    const avatar = (await getUserById(userId))?.profile?.avatarUrl || '';
    const match = /^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(avatar);
    if (!match || !imageTypes.has(match[1].toLowerCase())) return new NextResponse(null, { status: 404 });
    return new NextResponse(Buffer.from(match[2], 'base64'), {
      headers: {
        'Content-Type': match[1].toLowerCase(),
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return errorResponse(error, 500);
  }
}
