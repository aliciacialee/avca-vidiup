export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url

    if (!pathname.startsWith('/api/')) {
      return new Response(null, { status: 404 })
    }

    const method = request.method

    // POST /api/trips/verify
    if (pathname === '/api/trips/verify' && method === 'POST') {
      return handleVerifyTrip(request, env)
    }

    // POST /api/upload/presign
    if (pathname === '/api/upload/presign' && method === 'POST') {
      return handlePresign(request, env)
    }

    // PUT /api/upload/:fileId  (single upload ≤ 90MB)
    const uploadMatch = pathname.match(/^\/api\/upload\/([^/]+)$/)
    if (uploadMatch && method === 'PUT') {
      return handleUpload(request, env, uploadMatch[1])
    }

    // POST /api/upload/multipart/start  (large file: step 1)
    if (pathname === '/api/upload/multipart/start' && method === 'POST') {
      return handleMultipartStart(request, env)
    }

    // PUT /api/upload/multipart/:fileId/part/:partNumber  (large file: step 2)
    const partMatch = pathname.match(/^\/api\/upload\/multipart\/([^/]+)\/part\/(\d+)$/)
    if (partMatch && method === 'PUT') {
      return handleMultipartPart(request, env, partMatch[1], parseInt(partMatch[2], 10))
    }

    // POST /api/upload/multipart/:fileId/complete  (large file: step 3)
    const completeMatch = pathname.match(/^\/api\/upload\/multipart\/([^/]+)\/complete$/)
    if (completeMatch && method === 'POST') {
      return handleMultipartComplete(request, env, completeMatch[1])
    }

    // GET /api/gallery/trips
    if (pathname === '/api/gallery/trips' && method === 'GET') {
      return handleGalleryTrips(env)
    }

    // GET /api/gallery/trips/:id/photos
    const galleryPhotosMatch = pathname.match(/^\/api\/gallery\/trips\/([^/]+)\/photos$/)
    if (galleryPhotosMatch && method === 'GET') {
      return handleGalleryPhotos(env, galleryPhotosMatch[1])
    }

    // GET /api/files/:fileId  (serve public R2 file)
    const fileServeMatch = pathname.match(/^\/api\/files\/([^/]+)$/)
    if (fileServeMatch && method === 'GET') {
      return handleServeFile(env, fileServeMatch[1])
    }

    // GET /api/admin/trips
    if (pathname === '/api/admin/trips' && method === 'GET') {
      return handleListTrips(env)
    }

    // POST /api/admin/trips
    if (pathname === '/api/admin/trips' && method === 'POST') {
      return handleCreateTrip(request, env)
    }

    // GET /api/admin/trips/:id/files
    const tripFilesMatch = pathname.match(/^\/api\/admin\/trips\/([^/]+)\/files$/)
    if (tripFilesMatch && method === 'GET') {
      return handleListFiles(env, tripFilesMatch[1])
    }

    // DELETE /api/admin/files/:id
    const fileDeleteMatch = pathname.match(/^\/api\/admin\/files\/([^/]+)$/)
    if (fileDeleteMatch && method === 'DELETE') {
      return handleDeleteFile(env, fileDeleteMatch[1])
    }

    return json({ error: 'Not found' }, 404)
  },
} satisfies ExportedHandler<Env>

// ── 模組 2：TripGate ──────────────────────────────────────────────

type TripRow = { id: string; name: string; end_at: number }

async function handleVerifyTrip(request: Request, env: Env): Promise<Response> {
  let body: { code?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const code = body.code?.trim()
  if (!code) return json({ error: 'Missing code' }, 400)

  const now = Math.floor(Date.now() / 1000)
  const trip = await env.DB.prepare(
    'SELECT id, name, end_at FROM trips WHERE code = ?'
  ).bind(code).first<TripRow>()

  if (!trip) {
    return json({ valid: false, expired: false, tripName: null })
  }
  if (trip.end_at < now) {
    return json({ valid: false, expired: true, tripName: trip.name })
  }
  return json({ valid: true, expired: false, tripId: trip.id, tripName: trip.name })
}

// ── 模組 3：Upload ────────────────────────────────────────────────

type PresignBody = {
  tripId: string
  uploaderName: string
  fileName: string
  mimeType: string
  isPrivate: boolean
}

async function handlePresign(request: Request, env: Env): Promise<Response> {
  let body: PresignBody
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const { tripId, uploaderName, fileName, mimeType, isPrivate } = body
  if (!tripId || !uploaderName || !fileName) {
    return json({ error: 'Missing required fields' }, 400)
  }

  // Verify trip exists
  const trip = await env.DB.prepare(
    'SELECT id, name FROM trips WHERE id = ?'
  ).bind(tripId).first<{ id: string; name: string }>()
  if (!trip) return json({ error: 'Trip not found' }, 404)

  const fileId = crypto.randomUUID()
  const date = new Date().toISOString().split('T')[0]   // YYYY-MM-DD
  const safeTrip = sanitizePath(trip.name)
  const safeUploader = sanitizePath(uploaderName)
  const safeFile = sanitizePath(fileName)
  // Prefix with fileId to avoid collisions while keeping original name readable
  const filePath = `${safeTrip}/${date}/${safeUploader}/${fileId}_${safeFile}`

  const now = Math.floor(Date.now() / 1000)
  await env.DB.prepare(
    `INSERT INTO files (id, trip_id, uploader_name, original_name, file_path, mime_type, size, is_private, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(fileId, tripId, uploaderName, fileName, filePath, mimeType || null, null, isPrivate ? 1 : 0, now).run()

  return json({ fileId })
}

async function handleUpload(request: Request, env: Env, fileId: string): Promise<Response> {
  if (!request.body) return json({ error: 'No body' }, 400)

  const file = await env.DB.prepare(
    'SELECT file_path, mime_type FROM files WHERE id = ? AND upload_completed_at IS NULL'
  ).bind(fileId).first<{ file_path: string; mime_type: string | null }>()

  if (!file) return json({ error: 'File not found or already uploaded' }, 404)

  const contentLength = request.headers.get('Content-Length')
  const size = contentLength ? parseInt(contentLength, 10) : undefined

  await env.BUCKET.put(file.file_path, request.body, {
    httpMetadata: {
      contentType: file.mime_type ?? 'application/octet-stream',
    },
  })

  const now = Math.floor(Date.now() / 1000)
  await env.DB.prepare(
    'UPDATE files SET upload_completed_at = ?, size = ? WHERE id = ?'
  ).bind(now, size ?? null, fileId).run()

  return json({ ok: true })
}

// ── Multipart upload (大檔案 > 90MB) ─────────────────────────────

async function handleMultipartStart(request: Request, env: Env): Promise<Response> {
  let body: { tripId: string; uploaderName: string; fileName: string; mimeType: string; isPrivate: boolean }
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const { tripId, uploaderName, fileName, mimeType, isPrivate } = body
  if (!tripId || !uploaderName || !fileName) return json({ error: 'Missing fields' }, 400)

  const trip = await env.DB.prepare('SELECT id, name FROM trips WHERE id = ?')
    .bind(tripId).first<{ id: string; name: string }>()
  if (!trip) return json({ error: 'Trip not found' }, 404)

  const fileId = crypto.randomUUID()
  const date = new Date().toISOString().split('T')[0]
  const filePath = `${sanitizePath(trip.name)}/${date}/${sanitizePath(uploaderName)}/${fileId}_${sanitizePath(fileName)}`

  const multipart = await env.BUCKET.createMultipartUpload(filePath, {
    httpMetadata: { contentType: mimeType || 'application/octet-stream' },
  })

  const now = Math.floor(Date.now() / 1000)
  await env.DB.prepare(
    `INSERT INTO files (id, trip_id, uploader_name, original_name, file_path, mime_type, size, is_private, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(fileId, tripId, uploaderName, fileName, filePath, mimeType || null, null, isPrivate ? 1 : 0, now).run()

  return json({ fileId, uploadId: multipart.uploadId, filePath })
}

async function handleMultipartPart(
  request: Request, env: Env, fileId: string, partNumber: number
): Promise<Response> {
  if (!request.body) return json({ error: 'No body' }, 400)
  const uploadId = request.headers.get('X-Upload-Id')
  if (!uploadId) return json({ error: 'Missing X-Upload-Id' }, 400)

  const file = await env.DB.prepare('SELECT file_path FROM files WHERE id = ?')
    .bind(fileId).first<{ file_path: string }>()
  if (!file) return json({ error: 'File not found' }, 404)

  const multipart = env.BUCKET.resumeMultipartUpload(file.file_path, uploadId)
  const part = await multipart.uploadPart(partNumber, request.body)

  return json({ partNumber: part.partNumber, etag: part.etag })
}

async function handleMultipartComplete(
  request: Request, env: Env, fileId: string
): Promise<Response> {
  let body: { uploadId: string; parts: { partNumber: number; etag: string }[]; size: number }
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const file = await env.DB.prepare('SELECT file_path FROM files WHERE id = ?')
    .bind(fileId).first<{ file_path: string }>()
  if (!file) return json({ error: 'File not found' }, 404)

  const multipart = env.BUCKET.resumeMultipartUpload(file.file_path, body.uploadId)
  await multipart.complete(body.parts)

  const now = Math.floor(Date.now() / 1000)
  await env.DB.prepare('UPDATE files SET upload_completed_at = ?, size = ? WHERE id = ?')
    .bind(now, body.size ?? null, fileId).run()

  return json({ ok: true })
}

// ── Gallery ───────────────────────────────────────────────────────

async function handleGalleryTrips(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, name, start_at, end_at FROM trips ORDER BY start_at DESC'
  ).all<{ id: string; name: string; start_at: number; end_at: number }>()
  return json(results)
}

type GalleryFile = {
  id: string
  original_name: string
  mime_type: string | null
  uploader_name: string
  uploaded_at: number
}

async function handleGalleryPhotos(env: Env, tripId: string): Promise<Response> {
  const trip = await env.DB.prepare(
    'SELECT id, name FROM trips WHERE id = ?'
  ).bind(tripId).first<{ id: string; name: string }>()
  if (!trip) return json({ error: 'Trip not found' }, 404)

  const { results } = await env.DB.prepare(
    `SELECT id, original_name, mime_type, uploader_name, uploaded_at
     FROM files
     WHERE trip_id = ? AND is_private = 0 AND upload_completed_at IS NOT NULL
     ORDER BY uploaded_at ASC`
  ).bind(tripId).all<GalleryFile>()

  return json({ trip, files: results })
}

async function handleServeFile(env: Env, fileId: string): Promise<Response> {
  const file = await env.DB.prepare(
    'SELECT file_path, mime_type, is_private FROM files WHERE id = ? AND upload_completed_at IS NOT NULL'
  ).bind(fileId).first<{ file_path: string; mime_type: string | null; is_private: number }>()

  if (!file) return new Response('Not found', { status: 404 })
  if (file.is_private === 1) return new Response('Forbidden', { status: 403 })

  const object = await env.BUCKET.get(file.file_path)
  if (!object) return new Response('Not found', { status: 404 })

  return new Response(object.body, {
    headers: {
      'Content-Type': file.mime_type ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000',
    },
  })
}

// ── 模組 4：AdminTrips ────────────────────────────────────────────

async function handleListTrips(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, name, code, start_at, end_at, created_at FROM trips ORDER BY created_at DESC'
  ).all<{ id: string; name: string; code: string; start_at: number; end_at: number; created_at: number }>()
  return json(results)
}

type CreateTripBody = {
  name: string
  code: string
  start_at: number  // Unix epoch seconds
  end_at: number
}

async function handleCreateTrip(request: Request, env: Env): Promise<Response> {
  let body: CreateTripBody
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const { name, code, start_at, end_at } = body
  if (!name?.trim() || !code?.trim() || !start_at || !end_at) {
    return json({ error: 'Missing required fields' }, 400)
  }
  if (end_at <= start_at) {
    return json({ error: 'end_at must be after start_at' }, 400)
  }

  // Check code uniqueness
  const existing = await env.DB.prepare('SELECT id FROM trips WHERE code = ?').bind(code.trim()).first()
  if (existing) return json({ error: 'Code already in use' }, 409)

  const id = crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)
  await env.DB.prepare(
    'INSERT INTO trips (id, name, code, start_at, end_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, name.trim(), code.trim(), start_at, end_at, now).run()

  return json({ id }, 201)
}

// ── 模組 5：AdminFiles ────────────────────────────────────────────

type FileRow = {
  id: string
  uploader_name: string
  original_name: string
  file_path: string
  mime_type: string | null
  size: number | null
  is_private: number
  uploaded_at: number
  upload_completed_at: number | null
}

async function handleListFiles(env: Env, tripId: string): Promise<Response> {
  const trip = await env.DB.prepare('SELECT id FROM trips WHERE id = ?').bind(tripId).first()
  if (!trip) return json({ error: 'Trip not found' }, 404)

  const { results } = await env.DB.prepare(
    `SELECT id, uploader_name, original_name, file_path, mime_type, size,
            is_private, uploaded_at, upload_completed_at
     FROM files WHERE trip_id = ? ORDER BY uploaded_at DESC`
  ).bind(tripId).all<FileRow>()

  // Group by date then uploader
  const grouped: Record<string, Record<string, FileRow[]>> = {}
  for (const f of results) {
    const date = new Date(f.uploaded_at * 1000).toISOString().split('T')[0]
    grouped[date] ??= {}
    grouped[date][f.uploader_name] ??= []
    grouped[date][f.uploader_name].push(f)
  }

  return json(grouped)
}

async function handleDeleteFile(env: Env, fileId: string): Promise<Response> {
  const file = await env.DB.prepare(
    'SELECT file_path FROM files WHERE id = ?'
  ).bind(fileId).first<{ file_path: string }>()

  if (!file) return json({ error: 'File not found' }, 404)

  // Delete from R2 first, then DB
  await env.BUCKET.delete(file.file_path)
  await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(fileId).run()

  return json({ ok: true })
}

// ── Helpers ───────────────────────────────────────────────────────

/** Remove characters that are problematic in R2/S3 object keys */
function sanitizePath(s: string): string {
  return s.trim().replace(/[/\\?#%]/g, '_')
}


function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
