import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

// ── Types ─────────────────────────────────────────────────────────

type FileStatus = 'waiting' | 'uploading' | 'done' | 'failed'

interface QueueItem {
  localId: string
  file: File
  isPrivate: boolean
  status: FileStatus
  progress: number   // 0–100
}

// ── Constants ─────────────────────────────────────────────────────

const MAX_CONCURRENT = 4
const MAX_RETRIES = 3

// ── Component ─────────────────────────────────────────────────────

export default function UploadPage() {
  const navigate = useNavigate()
  const tripRef = useRef<{ id: string; name: string } | null>(null)
  const uploaderRef = useRef('')

  const [items, setItems] = useState<QueueItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [allDone, setAllDone] = useState(false)

  useEffect(() => {
    const raw = sessionStorage.getItem('vidiup_trip')
    const name = sessionStorage.getItem('vidiup_uploader')
    if (!raw || !name) { navigate('/'); return }
    tripRef.current = JSON.parse(raw)
    uploaderRef.current = name
  }, [navigate])

  // ── File selection ──────────────────────────────────────────────

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    const next: QueueItem[] = files.map(file => ({
      localId: crypto.randomUUID(),
      file,
      isPrivate: false,
      status: 'waiting',
      progress: 0,
    }))
    setItems(prev => [...prev, ...next])
    e.target.value = ''
  }

  function togglePrivate(localId: string) {
    setItems(prev =>
      prev.map(i => i.localId === localId ? { ...i, isPrivate: !i.isPrivate } : i)
    )
  }

  function removeItem(localId: string) {
    setItems(prev => prev.filter(i => i.localId !== localId))
  }

  // ── Update helper (safe for use inside async) ───────────────────

  function patchItem(localId: string, patch: Partial<QueueItem>) {
    setItems(prev => prev.map(i => i.localId === localId ? { ...i, ...patch } : i))
  }

  // ── Upload logic ────────────────────────────────────────────────

  const SINGLE_LIMIT = 90 * 1024 * 1024   // 90MB — below Workers 100MB limit
  const CHUNK_SIZE   = 50 * 1024 * 1024   // 50MB per part

  /** Single-file upload (≤ 90MB) via Worker proxy */
  async function uploadSingle(item: QueueItem, trip: { id: string }, uploader: string): Promise<void> {
    const res = await fetch('/api/upload/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tripId: trip.id, uploaderName: uploader,
        fileName: item.file.name,
        mimeType: item.file.type || 'application/octet-stream',
        isPrivate: item.isPrivate,
      }),
    })
    if (!res.ok) throw new Error('presign failed')
    const { fileId } = await res.json()

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', `/api/upload/${fileId}`)
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) patchItem(item.localId, { progress: Math.round(e.loaded / e.total * 100) })
      }
      xhr.onload = () => xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`))
      xhr.onerror = () => reject(new Error('network'))
      xhr.send(item.file)
    })
    patchItem(item.localId, { status: 'done', progress: 100 })
  }

  /** Multipart upload (> 90MB): split into 50MB chunks */
  async function uploadMultipart(item: QueueItem, trip: { id: string }, uploader: string): Promise<void> {
    // Step 1: start
    const startRes = await fetch('/api/upload/multipart/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tripId: trip.id, uploaderName: uploader,
        fileName: item.file.name,
        mimeType: item.file.type || 'application/octet-stream',
        isPrivate: item.isPrivate,
      }),
    })
    if (!startRes.ok) throw new Error('multipart start failed')
    const { fileId, uploadId } = await startRes.json()

    // Step 2: upload parts sequentially
    const totalChunks = Math.ceil(item.file.size / CHUNK_SIZE)
    const parts: { partNumber: number; etag: string }[] = []

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE
      const chunk = item.file.slice(start, Math.min(start + CHUNK_SIZE, item.file.size))

      const partRes = await new Promise<Response>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', `/api/upload/multipart/${fileId}/part/${i + 1}`)
        xhr.setRequestHeader('X-Upload-Id', uploadId)
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const overall = Math.round((i / totalChunks + e.loaded / e.total / totalChunks) * 100)
            patchItem(item.localId, { progress: overall })
          }
        }
        xhr.onload = () => resolve(new Response(xhr.responseText, { status: xhr.status }))
        xhr.onerror = () => reject(new Error('network'))
        xhr.send(chunk)
      })
      if (!partRes.ok) throw new Error(`Part ${i + 1} failed`)
      const { partNumber, etag } = await partRes.json()
      parts.push({ partNumber, etag })
    }

    // Step 3: complete
    const completeRes = await fetch(`/api/upload/multipart/${fileId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId, parts, size: item.file.size }),
    })
    if (!completeRes.ok) throw new Error('multipart complete failed')

    patchItem(item.localId, { status: 'done', progress: 100 })
  }

  async function uploadOne(item: QueueItem): Promise<void> {
    const trip = tripRef.current!
    const uploader = uploaderRef.current

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        patchItem(item.localId, { status: 'uploading', progress: 0 })

        if (item.file.size <= SINGLE_LIMIT) {
          await uploadSingle(item, trip, uploader)
        } else {
          await uploadMultipart(item, trip, uploader)
        }
        return  // success

      } catch {
        if (attempt === MAX_RETRIES) {
          patchItem(item.localId, { status: 'failed', progress: 0 })
        } else {
          await new Promise(r => setTimeout(r, 800 * attempt))
        }
      }
    }
  }

  async function startUpload() {
    setUploading(true)
    const pending = items.filter(i => i.status === 'waiting' || i.status === 'failed')

    const running = new Set<Promise<void>>()
    for (const item of pending) {
      const p: Promise<void> = uploadOne(item).finally(() => running.delete(p))
      running.add(p)
      if (running.size >= MAX_CONCURRENT) await Promise.race(running)
    }
    await Promise.all(running)

    setUploading(false)
    setAllDone(true)
  }

  async function retryFailed() {
    setAllDone(false)
    setItems(prev => prev.map(i => i.status === 'failed' ? { ...i, status: 'waiting' } : i))
    await startUpload()
  }

  // ── Derived state ───────────────────────────────────────────────

  const doneCount = items.filter(i => i.status === 'done').length
  const failedCount = items.filter(i => i.status === 'failed').length
  const hasWaiting = items.some(i => i.status === 'waiting')
  const canUpload = !uploading && items.some(i => i.status === 'waiting' || i.status === 'failed')

  // ── Render ──────────────────────────────────────────────────────

  if (allDone) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm p-8 text-center">
          <div className="text-4xl mb-4">{failedCount === 0 ? '✓' : '!'}</div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">上傳完成</h2>
          <p className="text-sm text-gray-500 mb-6">
            成功 {doneCount} 個
            {failedCount > 0 && <span className="text-red-500">，失敗 {failedCount} 個</span>}
          </p>
          {failedCount > 0 && (
            <button
              onClick={retryFailed}
              className="w-full bg-red-50 text-red-600 border border-red-200 rounded-xl py-3 font-medium mb-3"
            >
              重試失敗的檔案
            </button>
          )}
          <button
            onClick={() => { setItems([]); setAllDone(false) }}
            className="w-full bg-blue-600 text-white rounded-xl py-3 font-medium"
          >
            繼續上傳更多
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400">行程</p>
            <p className="font-semibold text-gray-800">{tripRef.current?.name ?? '—'}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">上傳者</p>
            <p className="text-sm text-gray-700">{uploaderRef.current}</p>
          </div>
        </div>
      </div>

      {/* iOS background warning */}
      {uploading && (
        <div className="bg-amber-50 border-b border-amber-100 px-4 py-2 text-center">
          <p className="text-xs text-amber-700">上傳中，請保持頁面開啟</p>
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto max-w-lg mx-auto w-full px-4 py-4 space-y-2">
        {items.length === 0 && (
          <div className="text-center text-gray-400 py-16 text-sm">
            點擊下方按鈕選取照片或影片
          </div>
        )}

        {items.map(item => (
          <FileRow
            key={item.localId}
            item={item}
            onTogglePrivate={() => togglePrivate(item.localId)}
            onRemove={() => removeItem(item.localId)}
            disabled={uploading}
          />
        ))}
      </div>

      {/* Bottom actions */}
      <div className="bg-white border-t border-gray-100 px-4 py-4 safe-area-bottom">
        <div className="max-w-lg mx-auto space-y-3">
          {/* Add files */}
          <label className={`flex items-center justify-center gap-2 w-full border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-500 cursor-pointer ${uploading ? 'opacity-40 pointer-events-none' : ''}`}>
            <span>+ 選取照片 / 影片</span>
            <input
              type="file"
              multiple
              accept="image/*,video/*"
              className="hidden"
              onChange={handleFiles}
              disabled={uploading}
            />
          </label>

          {/* Upload / progress summary */}
          {items.length > 0 && (
            <button
              onClick={startUpload}
              disabled={!canUpload}
              className="w-full bg-blue-600 text-white rounded-xl py-3 font-medium disabled:opacity-40"
            >
              {uploading
                ? `上傳中… (${doneCount}/${items.length})`
                : hasWaiting
                  ? `上傳 ${items.filter(i => i.status === 'waiting').length} 個檔案`
                  : '重試失敗的檔案'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── FileRow ───────────────────────────────────────────────────────

function FileRow({
  item,
  onTogglePrivate,
  onRemove,
  disabled,
}: {
  item: QueueItem
  onTogglePrivate: () => void
  onRemove: () => void
  disabled: boolean
}) {
  const statusColor = {
    waiting: 'text-gray-400',
    uploading: 'text-blue-500',
    done: 'text-green-500',
    failed: 'text-red-500',
  }[item.status]

  const statusLabel = {
    waiting: '等待中',
    uploading: `${item.progress}%`,
    done: '完成',
    failed: '失敗',
  }[item.status]

  return (
    <div className="bg-white rounded-xl p-3 shadow-xs border border-gray-100">
      <div className="flex items-start gap-3">
        {/* File icon */}
        <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-lg flex-shrink-0">
          {item.file.type.startsWith('video') ? '🎥' : '🖼'}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">{item.file.name}</p>
          <p className="text-xs text-gray-400">{formatSize(item.file.size)}</p>

          {/* Progress bar */}
          {item.status === 'uploading' && (
            <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-200"
                style={{ width: `${item.progress}%` }}
              />
            </div>
          )}
        </div>

        {/* Status / actions */}
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <span className={`text-xs font-medium ${statusColor}`}>{statusLabel}</span>

          {item.status === 'waiting' && (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={item.isPrivate}
                  onChange={onTogglePrivate}
                  disabled={disabled}
                  className="w-3 h-3"
                />
                不公開
              </label>
              {!disabled && (
                <button onClick={onRemove} className="text-gray-300 hover:text-red-400 text-base leading-none">
                  ×
                </button>
              )}
            </div>
          )}

          {item.status === 'done' && item.isPrivate && (
            <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">不公開</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Utils ─────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
