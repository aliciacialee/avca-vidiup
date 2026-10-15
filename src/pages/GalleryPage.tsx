import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface Trip {
  id: string
  name: string
  start_at: number
  end_at: number
}

export default function GalleryPage() {
  const navigate = useNavigate()
  const [trips, setTrips] = useState<Trip[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/gallery/trips')
      .then(r => r.json())
      .then(data => { setTrips(data); setLoading(false) })
  }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-100 px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-gray-400 hover:text-gray-600 text-xl leading-none">←</button>
          <h1 className="text-lg font-semibold text-gray-800">行程相簿</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4">
        {loading && <p className="text-center text-gray-400 py-12 text-sm">載入中…</p>}
        {!loading && trips.length === 0 && (
          <p className="text-center text-gray-400 py-12 text-sm">還沒有行程</p>
        )}
        <div className="grid grid-cols-1 gap-3">
          {trips.map(trip => (
            <button
              key={trip.id}
              onClick={() => navigate(`/gallery/${trip.id}`)}
              className="bg-white rounded-2xl border border-gray-100 p-5 text-left hover:border-blue-200 hover:shadow-sm transition-all"
            >
              <h2 className="font-semibold text-gray-800 mb-1">{trip.name}</h2>
              <p className="text-sm text-gray-400">
                {fmtDate(trip.start_at)} — {fmtDate(trip.end_at)}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function fmtDate(epoch: number): string {
  return new Date(epoch * 1000).toLocaleDateString('zh-TW', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}
