import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/api";

interface Track {
  id: string;
  title: string;
  album_id: string;
  created_at: string;
}

interface Album {
  id: string;
  title: string;
  artist_id: string;
  created_at: string;
  edges?: {
    tracks?: Track[];
  };
}

function Album() {
  const { albumId } = useParams<{ albumId: string }>();
  const navigate = useNavigate();
  const [album, setAlbum] = useState<Album | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAlbum = async () => {
      if (!albumId) {
        setError("Album ID is required");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const response = await apiFetch(`/api/v1/albums/${albumId}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch album: ${response.statusText}`);
        }
        const data = await response.json();
        setAlbum(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch album");
      } finally {
        setLoading(false);
      }
    };

    fetchAlbum();
  }, [albumId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
          <p className="mt-4 text-muted-foreground">Loading album...</p>
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
          <button
            onClick={() => navigate(-1)}
            className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const tracks = album?.edges?.tracks || [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate(-1)}
            className="mb-4 text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back
          </button>
          <h1 className="text-4xl font-bold mb-2">{album?.title || "Album"}</h1>
          <p className="text-muted-foreground">
            {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
          </p>
        </div>

        {/* Tracks List */}
        {tracks.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground text-lg">No tracks found</p>
          </div>
        ) : (
          <div className="space-y-1">
            {tracks.map((track, index) => (
              <div
                key={track.id}
                className="group flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-accent transition-colors cursor-pointer"
              >
                <span className="text-muted-foreground text-sm w-8 text-right group-hover:text-foreground">
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                    {track.title}
                  </h3>
                </div>
                <button className="opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:scale-110">
                  <svg
                    className="w-5 h-5 text-primary"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Album;
