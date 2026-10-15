import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

interface GalleryFile {
  id: string
  original_name: string
  mime_type: string | null
  uploader_name: string
  uploaded_at: number
}

interface TripInfo {
  id: string
  name: string
}

export default function TripGalleryPage() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()
  const [trip, setTrip] = useState<TripInfo | null>(null)
  const [files, setFiles] = useState<GalleryFile[]>([])
  const [loading, setLoading] = useState(true)
  const [lightbox, setLightbox] = useState<GalleryFile | null>(null)

  useEffect(() => {
    if (!tripId) return
    fetch(`/api/gallery/trips/${tripId}/photos`)
      .then(r => r.json())
      .then(data => {
        setTrip(data.trip)
        setFiles(data.files)
        setLoading(false)
      })
  }, [tripId])

  const images = files.filter(f => !f.mime_type?.startsWith('video'))
  const videos = files.filter(f => f.mime_type?.startsWith('video'))

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <div className="bg-gray-950 border-b border-gray-800 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <button onClick={() => navigate('/gallery')} className="text-gray-400 hover:text-white text-xl leading-none">←</button>
          <div>
            <h1 className="text-white font-semibold">{trip?.name ?? '…'}</h1>
            {!loading && (
              <p className="text-xs text-gray-500">
                {images.length} 張照片{videos.length > 0 ? `・${videos.length} 支影片` : ''}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-2 py-4">
        {loading && <p className="text-center text-gray-500 py-16 text-sm">載入中…</p>}

        {!loading && files.length === 0 && (
          <p className="text-center text-gray-500 py-16 text-sm">還沒有公開的照片</p>
        )}

        {/* Photo grid */}
        {images.length > 0 && (
          <div className="grid grid-cols-3 gap-1 mb-6">
            {images.map(file => (
              <ImageTile
                key={file.id}
                file={file}
                onClick={() => setLightbox(file)}
              />
            ))}
          </div>
        )}

        {/* Videos section */}
        {videos.length > 0 && (
          <div className="px-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">影片</p>
            <div className="space-y-3">
              {videos.map(file => (
                <VideoTile key={file.id} file={file} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <Lightbox
          file={lightbox}
          files={images}
          onClose={() => setLightbox(null)}
          onNav={(f) => setLightbox(f)}
        />
      )}
    </div>
  )
}

// ── ImageTile ─────────────────────────────────────────────────────

function ImageTile({ file, onClick }: { file: GalleryFile; onClick: () => void }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <button
      onClick={onClick}
      className="relative aspect-square bg-gray-800 overflow-hidden focus:outline-none"
    >
      {!loaded && <div className="absolute inset-0 bg-gray-800 animate-pulse" />}
      <img
        src={`/api/files/${file.id}`}
        alt={file.original_name}
        className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setLoaded(true)}
      />
    </button>
  )
}

// ── VideoTile ─────────────────────────────────────────────────────

function VideoTile({ file }: { file: GalleryFile }) {
  return (
    <div className="bg-gray-900 rounded-xl overflow-hidden">
      <video
        src={`/api/files/${file.id}`}
        controls
        preload="metadata"
        className="w-full max-h-96 bg-black"
      />
      <div className="px-3 py-2">
        <p className="text-sm text-gray-300 truncate">{file.original_name}</p>
        <p className="text-xs text-gray-600">{file.uploader_name}</p>
      </div>
    </div>
  )
}

// ── Lightbox ──────────────────────────────────────────────────────

function Lightbox({
  file,
  files,
  onClose,
  onNav,
}: {
  file: GalleryFile
  files: GalleryFile[]
  onClose: () => void
  onNav: (f: GalleryFile) => void
}) {
  const idx = files.findIndex(f => f.id === file.id)
  const touchStartX = useRef<number | null>(null)

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose()
    if (e.key === 'ArrowRight' && idx < files.length - 1) onNav(files[idx + 1])
    if (e.key === 'ArrowLeft' && idx > 0) onNav(files[idx - 1])
  }

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (dx < -50 && idx < files.length - 1) onNav(files[idx + 1])
    if (dx > 50 && idx > 0) onNav(files[idx - 1])
    touchStartX.current = null
  }

  return (
    <div
      className="fixed inset-0 bg-black/95 z-50 flex flex-col"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      tabIndex={0}
      autoFocus
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" onClick={e => e.stopPropagation()}>
        <div>
          <p className="text-white text-sm font-medium">{file.uploader_name}</p>
          <p className="text-gray-500 text-xs">{file.original_name}</p>
        </div>
        <div className="flex items-center gap-4">
          <a
            href={`/api/files/${file.id}`}
            download={file.original_name}
            className="text-gray-400 hover:text-white text-sm"
            onClick={e => e.stopPropagation()}
          >
            下載
          </a>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
        </div>
      </div>

      {/* Image */}
      <div className="flex-1 flex items-center justify-center px-4 min-h-0" onClick={e => e.stopPropagation()}>
        <img
          src={`/api/files/${file.id}`}
          alt={file.original_name}
          className="max-w-full max-h-full object-contain"
        />
      </div>

      {/* Nav arrows (desktop) */}
      {idx > 0 && (
        <button
          onClick={e => { e.stopPropagation(); onNav(files[idx - 1]) }}
          className="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full items-center justify-center text-white"
        >
          ‹
        </button>
      )}
      {idx < files.length - 1 && (
        <button
          onClick={e => { e.stopPropagation(); onNav(files[idx + 1]) }}
          className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full items-center justify-center text-white"
        >
          ›
        </button>
      )}

      {/* Counter */}
      <p className="text-center text-gray-600 text-xs pb-4 flex-shrink-0">
        {idx + 1} / {files.length}
      </p>
    </div>
  )
}
