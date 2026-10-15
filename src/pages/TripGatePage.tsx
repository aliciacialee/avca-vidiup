import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'

type VerifyResult =
  | { valid: true; tripId: string; tripName: string }
  | { valid: false; expired: true; tripName: string }
  | { valid: false; expired: false; tripName: null }

type Step = 'code' | 'name'

export default function TripGatePage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('code')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [trip, setTrip] = useState<{ id: string; name: string } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/trips/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      })
      const data: VerifyResult = await res.json()

      if (!data.valid && data.expired) {
        setError(`「${data.tripName}」行程已結束，無法上傳。`)
        return
      }
      if (!data.valid) {
        setError('通行碼無效，請確認後再試。')
        return
      }

      setTrip({ id: data.tripId, name: data.tripName })
      setStep('name')
    } catch {
      setError('網路錯誤，請稍後再試。')
    } finally {
      setLoading(false)
    }
  }

  function handleEnter(e: React.FormEvent) {
    e.preventDefault()
    if (!trip || !name.trim()) return
    sessionStorage.setItem('vidiup_trip', JSON.stringify({ id: trip.id, name: trip.name }))
    sessionStorage.setItem('vidiup_uploader', name.trim())
    navigate('/upload')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm p-8">

        {step === 'code' && (
          <>
            <h1 className="text-xl font-semibold text-gray-800 mb-1">上傳素材</h1>
            <p className="text-sm text-gray-500 mb-6">輸入行程通行碼以繼續</p>
            <Link
              to="/gallery"
              className="flex items-center justify-center gap-1.5 w-full text-sm text-blue-600 bg-blue-50 rounded-xl py-2.5 mb-5 font-medium"
            >
              🖼 瀏覽行程相簿
            </Link>

            <form onSubmit={handleVerify} className="space-y-4">
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="通行碼"
                autoFocus
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base tracking-widest placeholder:tracking-normal placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {error && <p className="text-sm text-red-500">{error}</p>}
              <button
                type="submit"
                disabled={loading || !code.trim()}
                className="w-full bg-blue-600 text-white rounded-xl py-3 font-medium disabled:opacity-40"
              >
                {loading ? '驗證中…' : '繼續'}
              </button>
            </form>
          </>
        )}

        {step === 'name' && trip && (
          <>
            <div className="mb-6">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">行程</p>
              <h1 className="text-xl font-semibold text-gray-800">{trip.name}</h1>
            </div>

            <form onSubmit={handleEnter} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">你的名字</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="例如：小明"
                  autoFocus
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="submit"
                disabled={!name.trim()}
                className="w-full bg-blue-600 text-white rounded-xl py-3 font-medium disabled:opacity-40"
              >
                進入上傳頁面
              </button>
            </form>
          </>
        )}

      </div>
    </div>
  )
}
