import { NextResponse } from 'next/server'
import { getStateStore } from '@/lib/stateStore'

export const dynamic = 'force-dynamic'
export const preferredRegion = 'hnd1'

const DATA_URL_RE = /^data:([^;,]+);base64,([\s\S]+)$/

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id } = await Promise.resolve(context.params)
    const url = new URL(req.url)
    const field = url.searchParams.get('field')

    if (field !== 'avatar' && field !== 'background') {
      return NextResponse.json(
        { error: 'Invalid media field; expected avatar or background' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      )
    }

    if (!id) {
      return NextResponse.json(
        { error: 'Member id is required' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      )
    }

    const raw = await getStateStore().getMedia(id, field)
    if (!raw) {
      return new NextResponse('Not Found', {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      })
    }

    if (raw.startsWith('data:')) {
      const match = DATA_URL_RE.exec(raw)
      if (!match) {
        return NextResponse.json(
          { error: 'Malformed media data' },
          { status: 400, headers: { 'Cache-Control': 'no-store' } }
        )
      }

      const mimeType = match[1]
      const base64Data = match[2]
      const buffer = Buffer.from(base64Data, 'base64')

      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': mimeType,
          'Content-Length': String(buffer.byteLength),
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    }

    if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/')) {
      return NextResponse.redirect(new URL(raw, req.url), 302)
    }

    return new NextResponse('Not Found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('GET /api/members/[id]/media error:', error)
    return NextResponse.json(
      { error: 'Failed to load media' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
