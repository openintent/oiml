import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

interface Artist {
  id: string;
  name: string;
  created_at: string;
  edges?: {
    albums?: Array<{
      id: string;
      title: string;
    }>;
  };
}

function ArtistsList() {
  const navigate = useNavigate();
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchArtists = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/v1/artists`);
        if (!response.ok) {
          throw new Error(`Failed to fetch artists: ${response.statusText}`);
        }
        const data = await response.json();
        setArtists(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch artists");
      } finally {
        setLoading(false);
      }
    };

    fetchArtists();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
          <p className="mt-4 text-muted-foreground">Loading artists...</p>
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
        <h1 className="text-3xl font-bold mb-8">Artists</h1>

        {artists.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground text-lg">No artists found</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {artists.map((artist) => (
              <div
                key={artist.id}
                onClick={() => navigate(`/artist/${artist.id}`)}
                className="group bg-card rounded-lg p-4 hover:bg-accent transition-colors duration-200 cursor-pointer"
              >
                {/* Artist Avatar Placeholder */}
                <div className="relative mb-4 aspect-square rounded-full bg-linear-to-br from-primary/20 to-primary/5 overflow-hidden shadow-lg">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <svg
                      className="w-16 h-16 text-primary/40"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                    </svg>
                  </div>
                </div>

                {/* Artist Name */}
                <h3 className="font-semibold text-sm mb-1 line-clamp-2 group-hover:text-primary transition-colors text-center">
                  {artist.name}
                </h3>

                {/* Album Count */}
                <p className="text-xs text-muted-foreground line-clamp-1 text-center">
                  {artist.edges?.albums?.length || 0}{" "}
                  {(artist.edges?.albums?.length || 0) === 1 ? "album" : "albums"}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ArtistsList;

