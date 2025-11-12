import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/api";

interface Album {
  id: string;
  title: string;
  artist_id: string;
  created_at: string;
}

function AlbumsList() {
  const navigate = useNavigate();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const artistId = "96b46143-bb11-4ca6-bd0a-f4834d25dc20";

  useEffect(() => {
    const fetchAlbums = async () => {
      try {
        setLoading(true);
        const response = await apiFetch(`/api/v1/artists/${artistId}/albums`);
        if (!response.ok) {
          throw new Error(`Failed to fetch albums: ${response.statusText}`);
        }
        const data = await response.json();
        setAlbums(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch albums");
      } finally {
        setLoading(false);
      }
    };

    fetchAlbums();
  }, [artistId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
          <p className="mt-4 text-muted-foreground">Loading albums...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <p className="text-destructive text-lg font-semibold">Error</p>
          <p className="mt-2 text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-6 py-8">
        <h1 className="text-3xl font-bold mb-8">Albums</h1>

        {albums.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground text-lg">No albums found</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {albums.map((album) => (
              <div
                key={album.id}
                onClick={() => navigate(`/album/${album.id}`)}
                className="group bg-card rounded-lg p-4 hover:bg-accent transition-colors duration-200 cursor-pointer"
              >
                {/* Album Art Placeholder */}
                <div className="relative mb-4 aspect-square rounded-lg bg-linear-to-br from-primary/20 to-primary/5 overflow-hidden shadow-lg">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <svg
                      className="w-16 h-16 text-primary/40"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                    </svg>
                  </div>
                  {/* Play button overlay on hover */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                    <button className="w-12 h-12 rounded-full bg-primary flex items-center justify-center hover:scale-110 transition-transform">
                      <svg
                        className="w-6 h-6 text-primary-foreground ml-1"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Album Title */}
                <h3 className="font-semibold text-sm mb-1 line-clamp-2 group-hover:text-primary transition-colors">
                  {album.title}
                </h3>

                {/* Album Metadata */}
                <p className="text-xs text-muted-foreground line-clamp-1">
                  Album
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default AlbumsList;

