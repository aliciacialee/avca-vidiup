import { useEffect, useState } from 'react'

// ── Types ─────────────────────────────────────────────────────────

interface Trip {
  id: string
  name: string
  code: string
  start_at: number
  end_at: number
  created_at: number
}

interface FileEntry {
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

type GroupedFiles = Record<string, Record<string, FileEntry[]>>

// ── Component ─────────────────────────────────────────────────────

export default function AdminPage() {
  const [tab, setTab] = useState<'trips' | 'files'>('trips')
  const [trips, setTrips] = useState<Trip[]>([])
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null)
  const [groupedFiles, setGroupedFiles] = useState<GroupedFiles>({})
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)

  useEffect(() => {
    fetchTrips()
  }, [])

  async function fetchTrips() {
    const res = await fetch('/api/admin/trips')
    if (res.ok) setTrips(await res.json())
  }

  async function fetchFiles(trip: Trip) {
    setSelectedTrip(trip)
    setTab('files')
    setLoadingFiles(true)
    const res = await fetch(`/api/admin/trips/${trip.id}/files`)
    if (res.ok) setGroupedFiles(await res.json())
    setLoadingFiles(false)
  }

  async function deleteFile(fileId: string) {
    if (!confirm('確定刪除這個檔案？')) return
    const res = await fetch(`/api/admin/files/${fileId}`, { method: 'DELETE' })
    if (res.ok && selectedTrip) {
      await fetchFiles(selectedTrip)
    }
  }

  const totalFiles = Object.values(groupedFiles)
    .flatMap(byUploader => Object.values(byUploader).flat()).length

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-800">管理</h1>
          {tab === 'trips' && (
            <button
              onClick={() => setShowCreateForm(true)}
              className="bg-blue-600 text-white text-sm px-4 py-2 rounded-xl font-medium"
            >
              + 新增行程
            </button>
          )}
          {tab === 'files' && selectedTrip && (
            <button
              onClick={() => setTab('trips')}
              className="text-sm text-blue-600"
            >
              ← 返回行程
            </button>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4">

        {/* Create trip form */}
        {showCreateForm && (
          <CreateTripForm
            onCreated={() => { setShowCreateForm(false); fetchTrips() }}
            onCancel={() => setShowCreateForm(false)}
          />
        )}

        {/* Trip list */}
        {tab === 'trips' && !showCreateForm && (
          <div className="space-y-2">
            {trips.length === 0 && (
              <p className="text-center text-gray-400 py-12 text-sm">還沒有行程，點擊「新增行程」開始</p>
            )}
            {trips.map(trip => (
              <TripRow key={trip.id} trip={trip} onViewFiles={() => fetchFiles(trip)} />
            ))}
          </div>
        )}

        {/* File browser */}
        {tab === 'files' && selectedTrip && (
          <div>
            <div className="mb-4">
              <h2 className="font-semibold text-gray-800">{selectedTrip.name}</h2>
              <p className="text-xs text-gray-400">{totalFiles} 個檔案</p>
            </div>

            {loadingFiles && <p className="text-center text-gray-400 py-8 text-sm">載入中…</p>}

            {!loadingFiles && totalFiles === 0 && (
              <p className="text-center text-gray-400 py-8 text-sm">還沒有人上傳</p>
            )}

            {Object.entries(groupedFiles).sort(([a], [b]) => b.localeCompare(a)).map(([date, byUploader]) => (
              <div key={date} className="mb-6">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">{date}</p>
                {Object.entries(byUploader).map(([uploader, files]) => (
                  <div key={uploader} className="mb-4">
                    <p className="text-sm font-medium text-gray-600 mb-2">{uploader}</p>
                    <div className="space-y-1.5">
                      {files.map(file => (
                        <AdminFileRow key={file.id} file={file} onDelete={() => deleteFile(file.id)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── TripRow ───────────────────────────────────────────────────────

function TripRow({ trip, onViewFiles }: { trip: Trip; onViewFiles: () => void }) {
  const now = Math.floor(Date.now() / 1000)
  const isActive = trip.start_at <= now && now <= trip.end_at
  const isExpired = now > trip.end_at

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-gray-800">{trip.name}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              isActive ? 'bg-green-100 text-green-700' :
              isExpired ? 'bg-gray-100 text-gray-400' :
              'bg-yellow-100 text-yellow-700'
            }`}>
              {isActive ? '進行中' : isExpired ? '已結束' : '未開始'}
            </span>
          </div>
          <p className="text-sm text-gray-500 font-mono tracking-wider">通行碼：{trip.code}</p>
          <p className="text-xs text-gray-400 mt-1">
            {fmtDate(trip.start_at)} — {fmtDate(trip.end_at)}
          </p>
        </div>
        <button
          onClick={onViewFiles}
          className="text-sm text-blue-600 flex-shrink-0 mt-1"
        >
          查看素材
        </button>
      </div>
    </div>
  )
}

// ── AdminFileRow ──────────────────────────────────────────────────

function AdminFileRow({ file, onDelete }: { file: FileEntry; onDelete: () => void }) {
  const isVideo = file.mime_type?.startsWith('video')
  const isPending = !file.upload_completed_at

  return (
    <div className={`flex items-center gap-3 bg-white rounded-lg border border-gray-100 px-3 py-2.5 ${isPending ? 'opacity-50' : ''}`}>
      <span className="text-base flex-shrink-0">{isVideo ? '🎥' : '🖼'}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-800 truncate">{file.original_name}</p>
        <p className="text-xs text-gray-400">
          {file.size ? formatSize(file.size) : '—'}
          {file.is_private === 1 && <span className="ml-2 text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">不公開</span>}
          {isPending && <span className="ml-2 text-amber-500">上傳中</span>}
        </p>
      </div>
      {!isPending && (
        <button onClick={onDelete} className="text-gray-300 hover:text-red-400 text-sm flex-shrink-0">
          刪除
        </button>
      )}
    </div>
  )
}

// ── CreateTripForm ────────────────────────────────────────────────

function CreateTripForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [startDate, setStartDate] = useState(todayISO())
  const [endDate, setEndDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim() || !code.trim() || !startDate || !endDate) {
      setError('請填寫所有欄位')
      return
    }

    const start_at = Math.floor(new Date(startDate).getTime() / 1000)
    const end_at = Math.floor(new Date(endDate + 'T23:59:59').getTime() / 1000)
    if (end_at <= start_at) { setError('結束日期必須晚於開始日期'); return }

    setLoading(true)
    const res = await fetch('/api/admin/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), code: code.trim(), start_at, end_at }),
    })
    setLoading(false)

    if (res.ok) {
      onCreated()
    } else {
      const data = await res.json()
      setError(data.error ?? '建立失敗')
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-4">
      <h2 className="font-semibold text-gray-800 mb-4">新增行程</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-sm text-gray-600 mb-1">行程名稱</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="例如：東京五日行"
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">通行碼</label>
          <input
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="例如：tokyo2026"
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">開始日期</label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">結束日期</label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              min={startDate}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-40"
          >
            {loading ? '建立中…' : '建立行程'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Utils ─────────────────────────────────────────────────────────

function fmtDate(epoch: number): string {
  return new Date(epoch * 1000).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0]
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
