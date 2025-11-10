package main

import (
	"context"
	"log"
	"net/http"

	"streamify/ent"
	"streamify/ent/album"
	"streamify/ent/artist"
	"streamify/ent/user"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

func main() {
	client, err := ent.Open("postgres", "host=localhost port=5432 user=crystal dbname=streamify password=crystal sslmode=disable")
	if err != nil {
		log.Fatalf("failed opening connection to postgres: %v", err)
	}
	defer client.Close()

	// Run the auto migration tool.
	if err := client.Schema.Create(context.Background()); err != nil {
		log.Fatalf("failed creating schema resources: %v", err)
	}

	// Setup Gin router
	r := gin.Default()

	// Health check endpoint
	r.GET("/health", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	// User endpoints (v1)
	api := r.Group("/api/v1")
	{
		api.GET("/users", getUsers(client))
		api.GET("/users/:id", getUserByID(client))
		api.POST("/users", createUser(client))
		api.DELETE("/users/:id", deleteUser(client))

		// Artist endpoints
		api.GET("/artists", getArtists(client))
		api.POST("/artists", createArtist(client))
		api.GET("/artists/:id/albums", getArtistAlbums(client))

		// Album endpoints
		api.GET("/albums/:id", getAlbumByID(client))
		api.POST("/albums", createAlbum(client))
	}

	// User endpoints (non-versioned)
	apiNonVersioned := r.Group("/api")
	{
		apiNonVersioned.POST("/users", createUserWithBody(client))
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

// createUser creates a new user with email from request body
func createUser(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			Email string `json:"email" binding:"required"`
		}

		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		u, err := client.User.Create().
			SetEmail(body.Email).
			Save(context.Background())
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

// createUserWithBody creates a new user with email from request body
func createUserWithBody(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			Email string `json:"email" binding:"required"`
		}

		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		u, err := client.User.Create().
			SetEmail(body.Email).
			Save(context.Background())
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

// getArtists returns all artists
func getArtists(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		artists, err := client.Artist.Query().All(context.Background())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, artists)
	}
}

// createArtist creates a new artist with name from request body
func createArtist(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			Name string `json:"name" binding:"required"`
		}

		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		a, err := client.Artist.Create().
			SetName(body.Name).
			Save(context.Background())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusCreated, a)
	}
}

// getAlbumByID returns an album by ID
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
			WithArtist().
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

// createAlbum creates a new album with title and artist_id from request body
func createAlbum(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			Title    string `json:"title" binding:"required"`
			ArtistID string `json:"artist_id" binding:"required"`
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

		a, err := client.Album.Create().
			SetTitle(body.Title).
			SetArtistID(artistID).
			Save(context.Background())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusCreated, a)
	}
}
