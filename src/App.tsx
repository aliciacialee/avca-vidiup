import { BrowserRouter, Routes, Route } from 'react-router-dom'
import TripGatePage from './pages/TripGatePage'
import UploadPage from './pages/UploadPage'
import AdminPage from './pages/AdminPage'
import GalleryPage from './pages/GalleryPage'
import TripGalleryPage from './pages/TripGalleryPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TripGatePage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/gallery" element={<GalleryPage />} />
        <Route path="/gallery/:tripId" element={<TripGalleryPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
