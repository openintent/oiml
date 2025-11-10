import { Routes, Route } from "react-router-dom";
import ArtistsList from "./ArtistsList";
import Artist from "./components/Artist";
import Album from "./components/Album";

function App() {
  return (
    <Routes>
      <Route path="/" element={<ArtistsList />} />
      <Route path="/artist/:artistId" element={<Artist />} />
      <Route path="/album/:albumId" element={<Album />} />
    </Routes>
  );
}

export default App;
