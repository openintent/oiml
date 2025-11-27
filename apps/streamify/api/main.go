package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"streamify/auth"
	"streamify/ent"
	"streamify/ent/album"
	"streamify/ent/artist"
	"streamify/ent/user"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

func main() {
	client, err := ent.Open("postgres", os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatalf("failed opening connection to postgres: %v", err)
	}
	defer client.Close()

	// Run the auto migration tool.
	if err := client.Schema.Create(context.Background()); err != nil {
		log.Fatalf("failed creating schema resources: %v", err)
	}

	// Initialize auth
	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		log.Fatal("JWT_SECRET environment variable is required")
	}
	auth.InitJWT(jwtSecret)

	// Initialize auth config (24 hours access token, 168 hours refresh token)
	auth.InitAuthConfig(24, 168)

	// Setup Gin router
	r := gin.Default()

	// Health check endpoint
	r.GET("/health", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	// Auth routes (public)
	authGroup := r.Group("/api/auth")
	{
		authGroup.POST("/login", auth.Login(client))
		authGroup.POST("/register", auth.Register(client))
		authGroup.POST("/refresh", auth.Refresh(client))
	}

	// Protected routes - apply auth middleware to entire /api/v1/* group
	api := r.Group("/api/v1")
	api.Use(auth.AuthMiddleware()) // Apply auth middleware to all v1 routes
	{
		api.GET("/me", auth.Me(client))

		// User endpoints
		api.GET("/users", getUsers(client))
		api.GET("/users/:id", getUserByID(client))
		api.POST("/users", createUser(client))
		api.DELETE("/users/:id", deleteUser(client))

		// Artist endpoints
		api.GET("/artists", getArtists(client))
		api.GET("/artists/:id", getArtistByID(client))
		api.POST("/artists", createArtist(client))
		api.GET("/artists/:id/albums", getArtistAlbums(client))

		// Album endpoints
		api.GET("/albums/:id", getAlbumByID(client))
		api.POST("/albums", createAlbum(client))
		api.GET("/albums/:id/tracks", getAlbumTracks(client))

		// Track endpoints
		api.POST("/tracks", createTrack(client))
	}

	// User endpoints (non-versioned)
	apiNonVersioned := r.Group("/api")
	{
		apiNonVersioned.POST("/users", createUserWithBody(client))
		apiNonVersioned.GET("/schema", getSchema(client))
		apiNonVersioned.GET("/routes", getRoutes(r))
	}

	// Start server
	log.Println("Starting server on :8080")
	if err := r.Run(":8080"); err != nil {
		log.Fatalf("failed to start server: %v", err)
	}
}

// getUsers returns all users
func getUsers(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		users, err := client.User.Query().All(context.Background())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, users)
	}
}

// getUserByID returns a user by ID
func getUserByID(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		idStr := c.Param("id")
		id, err := uuid.Parse(idStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
			return
		}
		u, err := client.User.Query().Where(user.IDEQ(id)).Only(context.Background())
		if err != nil {
			if ent.IsNotFound(err) {
				c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, u)
	}
}

// createUser creates a new user with email and optional first_name/last_name from request body
func createUser(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			Email     string  `json:"email" binding:"required"`
			FirstName *string `json:"first_name"`
			LastName  *string `json:"last_name"`
		}

		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		create := client.User.Create().SetEmail(body.Email)
		if body.FirstName != nil {
			create = create.SetFirstName(*body.FirstName)
		}
		if body.LastName != nil {
			create = create.SetLastName(*body.LastName)
		}

		u, err := create.Save(context.Background())
		if err != nil {
			// Check for unique constraint violation
			if ent.IsConstraintError(err) {
				c.JSON(http.StatusConflict, gin.H{"error": "email already exists"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusCreated, u)
	}
}

// createUserWithBody creates a new user with email and optional first_name/last_name from request body
func createUserWithBody(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			Email     string  `json:"email" binding:"required"`
			FirstName *string `json:"first_name"`
			LastName  *string `json:"last_name"`
		}

		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		create := client.User.Create().SetEmail(body.Email)
		if body.FirstName != nil {
			create = create.SetFirstName(*body.FirstName)
		}
		if body.LastName != nil {
			create = create.SetLastName(*body.LastName)
		}

		u, err := create.Save(context.Background())
		if err != nil {
			// Check for unique constraint violation
			if ent.IsConstraintError(err) {
				c.JSON(http.StatusConflict, gin.H{"error": "email already exists"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusCreated, u)
	}
}

// deleteUser deletes a user by ID
func deleteUser(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		idStr := c.Param("id")
		id, err := uuid.Parse(idStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
			return
		}
		err = client.User.DeleteOneID(id).Exec(context.Background())
		if err != nil {
			if ent.IsNotFound(err) {
				c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "user deleted"})
	}
}

// getArtists returns all artists with their associated albums
func getArtists(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Use WithAlbums() to eager load the albums relation
		artists, err := client.Artist.Query().
			WithAlbums(). // Eager load albums relation
			All(context.Background())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, artists) // Albums are included in each artist
	}
}

// getArtistByID returns an artist by ID
func getArtistByID(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		idStr := c.Param("id")
		id, err := uuid.Parse(idStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid artist ID"})
			return
		}
		a, err := client.Artist.Query().
			Where(artist.IDEQ(id)).
			WithAlbums(). // Eager load albums relation
			Only(context.Background())
		if err != nil {
			if ent.IsNotFound(err) {
				c.JSON(http.StatusNotFound, gin.H{"error": "artist not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, a)
	}
}

// createArtist creates a new artist with name and optional image_url from request body
func createArtist(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			Name     string  `json:"name" binding:"required"`
			ImageURL *string `json:"image_url"`
		}

		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		create := client.Artist.Create().SetName(body.Name)
		if body.ImageURL != nil {
			create = create.SetImageURL(*body.ImageURL)
		}

		a, err := create.Save(context.Background())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusCreated, a)
	}
}

// getAlbumByID returns an album by ID with associated tracks
func getAlbumByID(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		idStr := c.Param("id")
		id, err := uuid.Parse(idStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid album ID"})
			return
		}
		a, err := client.Album.Query().
			Where(album.IDEQ(id)).
			WithArtist(). // Eager load artist relation
			WithTracks(). // Eager load tracks relation
			Only(context.Background())
		if err != nil {
			if ent.IsNotFound(err) {
				c.JSON(http.StatusNotFound, gin.H{"error": "album not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, a)
	}
}

// getArtistAlbums returns all albums for an artist
func getArtistAlbums(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		idStr := c.Param("id")
		artistID, err := uuid.Parse(idStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid artist ID"})
			return
		}

		// Verify artist exists
		_, err = client.Artist.Query().
			Where(artist.IDEQ(artistID)).
			Only(context.Background())
		if err != nil {
			if ent.IsNotFound(err) {
				c.JSON(http.StatusNotFound, gin.H{"error": "artist not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		albums, err := client.Album.Query().
			Where(album.ArtistIDEQ(artistID)).
			All(context.Background())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, albums)
	}
}

// getAlbumTracks returns an album with its associated tracks
func getAlbumTracks(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		idStr := c.Param("id")
		albumID, err := uuid.Parse(idStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid album ID"})
			return
		}

		// Use WithTracks() to eager load the tracks relation
		a, err := client.Album.Query().
			Where(album.IDEQ(albumID)).
			WithTracks(). // Eager load tracks relation
			Only(context.Background())
		if err != nil {
			if ent.IsNotFound(err) {
				c.JSON(http.StatusNotFound, gin.H{"error": "album not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, a) // Tracks are included in the album object
	}
}

// createAlbum creates a new album with title, artist_id, and optional image_url from request body
func createAlbum(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			Title    string  `json:"title" binding:"required"`
			ArtistID string  `json:"artist_id" binding:"required"`
			ImageURL *string `json:"image_url"`
		}

		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		artistID, err := uuid.Parse(body.ArtistID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid artist_id format"})
			return
		}

		// Verify artist exists
		_, err = client.Artist.Query().
			Where(artist.IDEQ(artistID)).
			Only(context.Background())
		if err != nil {
			if ent.IsNotFound(err) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "artist not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		create := client.Album.Create().
			SetTitle(body.Title).
			SetArtistID(artistID)
		if body.ImageURL != nil {
			create = create.SetImageURL(*body.ImageURL)
		}

		a, err := create.Save(context.Background())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusCreated, a)
	}
}

// createTrack creates a new track with title, album_id, and optional url from request body
func createTrack(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			Title   string  `json:"title" binding:"required"`
			AlbumID string  `json:"album_id" binding:"required"`
			URL     *string `json:"url"`
		}

		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		albumID, err := uuid.Parse(body.AlbumID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid album_id format"})
			return
		}

		// Verify album exists
		_, err = client.Album.Query().
			Where(album.IDEQ(albumID)).
			Only(context.Background())
		if err != nil {
			if ent.IsNotFound(err) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "album not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		create := client.Track.Create().
			SetTitle(body.Title).
			SetAlbumID(albumID)
		if body.URL != nil {
			create = create.SetURL(*body.URL)
		}

		t, err := create.Save(context.Background())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusCreated, t)
	}
}
