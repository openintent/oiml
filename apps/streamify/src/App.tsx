import { Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import ArtistsList from "./ArtistsList";
import Artist from "./components/Artist";
import Album from "./components/Album";
import ApiDocs from "./components/ApiDocs";
import Login from "./components/Login";

function ProtectedRoutes() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <Routes>
      <Route path="/" element={<ArtistsList />} />
      <Route path="/artist/:artistId" element={<Artist />} />
      <Route path="/album/:albumId" element={<Album />} />
      <Route path="/docs" element={<ApiDocs />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <ProtectedRoutes />
    </AuthProvider>
  );
}

export default App;
