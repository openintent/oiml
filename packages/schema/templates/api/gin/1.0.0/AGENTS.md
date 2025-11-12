# Gin API Implementation Guide

> **Template Version:** 1.0.0  
> **Compatible OIML Versions:** 0.1.x  
> **Compatible Gin Versions:** 1.9.x, 1.10.x, 1.11.x  
> **Last Updated:** 2025-01-27

This guide provides complete implementation instructions for applying OpenIntent API intents when using Gin as the API framework.

## When to Use This Guide

Use this guide when `api.framework` in `project.yaml` is set to `"gin"`.

## Prerequisites

- Go 1.18+ is installed
- Gin is installed: `go get github.com/gin-gonic/gin`
- Database client is configured (framework-agnostic)
- `main.go` or router setup file exists

## File Structure Convention

Gin uses a router-based approach with handler functions:

| Intent Path | Route Pattern | Handler Function |
|------------|---------------|------------------|
| `/api/users` | `api.GET("/users", ...)` | `getUsers(client)` |
| `/api/users/:id` | `api.GET("/users/:id", ...)` | `getUserByID(client)` |
| `/api/posts` | `api.GET("/posts", ...)` | `getPosts(client)` |

**Important:** For routes with path parameters (e.g., `:id`):
- Use `c.Param("id")` to extract the parameter
- Convert string parameters to appropriate types (int, UUID, etc.)
- Validate parameters before use

## Implementing `add_endpoint` Intent

### Steps

1. **Read intent** and extract:
   - HTTP method (GET, POST, PATCH, DELETE)
   - Path (e.g., `/api/customers`)
   - Entity name (for scaffolding)
   - Auth requirements (optional)

2. **Read `project.yaml`** to get:
   - `api.response.success.object` (e.g., `"data"`)
   - `api.response.error.object` (e.g., `"error"`)
   - `paths.api` (default: `"api"` or router location)
   - `database.framework` (e.g., `"ent"`)
   - `paths.types` (if applicable)

3. **Convert path to route pattern**:
   - `/api/customers` → `"/customers"`
   - `/api/users/:id` → `"/users/:id"`

4. **Create handler function** based on HTTP method

5. **Import dependencies**:
   - `github.com/gin-gonic/gin`
   - Database client (import based on your chosen database framework)
   - Entity types/models (if applicable)

6. **Structure response** according to `api.response` configuration

7. **Add error handling** with appropriate status codes

8. **Register route** in router setup

### Response Structure

Based on `api.response` configuration in `project.yaml`:

```yaml
api:
  response:
    success:
      object: data    # Success responses wrap result in "data" field
    error:
      object: error   # Error responses use "error" field
```

**Success Response:**
```go
gin.H{
    "data": [...results...]
}
```

**Error Response:**
```go
gin.H{
    "error": "Error message"
}
```

## HTTP Method Templates

### GET - Fetch All Entities

**Use Case:** Retrieve all records of an entity with optional filtering/pagination

```go
func get{EntityPlural}(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        // Query all {entity_plural} using your database client
        {entity_plural}, err := db.GetAll{EntityPlural}(context.Background())
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{
                "error": err.Error(),
            })
            return
        }
        
        c.JSON(http.StatusOK, gin.H{
            "data": {entity_plural},
        })
    }
}
```

**Note:** Replace `database.Client` and `GetAll{EntityPlural}` with your actual database client type and methods.

### GET - Fetch Single Entity by ID

**Use Case:** Retrieve one record by its ID

```go
import "errors"

func get{Entity}ByID(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        idStr := c.Param("id")
        id, err := strconv.Atoi(idStr) // or parse UUID, etc.
        if err != nil {
            c.JSON(http.StatusBadRequest, gin.H{
                "error": "invalid {entity} ID",
            })
            return
        }
        
        {entity}, err := db.Get{Entity}ByID(context.Background(), id)
        if err != nil {
            // Check if entity not found (adjust based on your database framework)
            if errors.Is(err, ErrNotFound) {
                c.JSON(http.StatusNotFound, gin.H{
                    "error": "{Entity} not found",
                })
                return
            }
            c.JSON(http.StatusInternalServerError, gin.H{
                "error": err.Error(),
            })
            return
        }
        
        c.JSON(http.StatusOK, gin.H{
            "data": {entity},
        })
    }
}
```

**Note:** Replace `database.Client`, `Get{Entity}ByID`, and `ErrNotFound` with your actual database client types and error handling patterns.

### POST - Create New Entity

**Use Case:** Create a new record

```go
func create{Entity}(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        var body struct {
            Field1 string `json:"field1" binding:"required"`
            Field2 string `json:"field2"`
            Field3 int    `json:"field3"`
        }
        
        if err := c.ShouldBindJSON(&body); err != nil {
            c.JSON(http.StatusBadRequest, gin.H{
                "error": err.Error(),
            })
            return
        }
        
        // Create {entity} using your database client
        {entity}, err := db.Create{Entity}(context.Background(), &body)
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{
                "error": err.Error(),
            })
            return
        }
        
        c.JSON(http.StatusCreated, gin.H{
            "data": {entity},
        })
    }
}
```

**Note:** Replace `database.Client` and `Create{Entity}` with your actual database client type and methods.

### PATCH - Update Entity

**Use Case:** Update an existing record

```go
import "errors"

func update{Entity}(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        idStr := c.Param("id")
        id, err := strconv.Atoi(idStr)
        if err != nil {
            c.JSON(http.StatusBadRequest, gin.H{
                "error": "invalid {entity} ID",
            })
            return
        }
        
        // Check if entity exists
        existing, err := db.Get{Entity}ByID(context.Background(), id)
        if err != nil {
            if errors.Is(err, ErrNotFound) {
                c.JSON(http.StatusNotFound, gin.H{
                    "error": "{Entity} not found",
                })
                return
            }
            c.JSON(http.StatusInternalServerError, gin.H{
                "error": err.Error(),
            })
            return
        }
        _ = existing // Use existing if needed
        
        var body struct {
            Field1 *string `json:"field1"`
            Field2 *string `json:"field2"`
            Field3 *int    `json:"field3"`
        }
        
        if err := c.ShouldBindJSON(&body); err != nil {
            c.JSON(http.StatusBadRequest, gin.H{
                "error": err.Error(),
            })
            return
        }
        
        // Update {entity} using your database client
        {entity}, err := db.Update{Entity}(context.Background(), id, &body)
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{
                "error": err.Error(),
            })
            return
        }
        
        c.JSON(http.StatusOK, gin.H{
            "data": {entity},
        })
    }
}
```

**Note:** Replace `database.Client`, `Get{Entity}ByID`, `Update{Entity}`, and `ErrNotFound` with your actual database client types and methods.

### DELETE - Remove Entity

**Use Case:** Delete a record by ID

```go
import "errors"

func delete{Entity}(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        idStr := c.Param("id")
        id, err := strconv.Atoi(idStr)
        if err != nil {
            c.JSON(http.StatusBadRequest, gin.H{
                "error": "invalid {entity} ID",
            })
            return
        }
        
        // Check if entity exists
        _, err = db.Get{Entity}ByID(context.Background(), id)
        if err != nil {
            if errors.Is(err, ErrNotFound) {
                c.JSON(http.StatusNotFound, gin.H{
                    "error": "{Entity} not found",
                })
                return
            }
            c.JSON(http.StatusInternalServerError, gin.H{
                "error": err.Error(),
            })
            return
        }
        
        // Delete {entity} using your database client
        err = db.Delete{Entity}(context.Background(), id)
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{
                "error": err.Error(),
            })
            return
        }
        
        c.JSON(http.StatusOK, gin.H{
            "message": "{Entity} deleted successfully",
        })
    }
}
```

**Note:** Replace `database.Client`, `Get{Entity}ByID`, `Delete{Entity}`, and `ErrNotFound` with your actual database client types and methods.

## Complete Example: User API Endpoints

### Intent File

```yaml
version: "0.1.0"
intents:
  - kind: add_endpoint
    scope: api
    method: GET
    path: /api/users
    entity: User
  
  - kind: add_endpoint
    scope: api
    method: POST
    path: /api/users
    entity: User
  
  - kind: add_endpoint
    scope: api
    method: GET
    path: /api/users/:id
    entity: User
  
  - kind: add_endpoint
    scope: api
    method: DELETE
    path: /api/users/:id
    entity: User
```

### Generated Code: `main.go`

```go
package main

import (
    "context"
    "errors"
    "log"
    "net/http"
    "strconv"

    "yourproject/database" // Replace with your database package

    "github.com/gin-gonic/gin"
)

var ErrNotFound = errors.New("not found")

func main() {
    // Initialize database client (replace with your database framework)
    db, err := database.NewClient("your-connection-string")
    if err != nil {
        log.Fatalf("failed opening database connection: %v", err)
    }
    defer db.Close()

    // Setup Gin router
    r := gin.Default()

    // Health check endpoint
    r.GET("/health", func(c *gin.Context) {
        c.Status(http.StatusOK)
    })

    // User endpoints
    api := r.Group("/api/v1")
    {
        api.GET("/users", getUsers(db))
        api.GET("/users/:id", getUserByID(db))
        api.POST("/users", createUser(db))
        api.DELETE("/users/:id", deleteUser(db))
    }

    // Start server
    log.Println("Starting server on :8080")
    if err := r.Run(":8080"); err != nil {
        log.Fatalf("failed to start server: %v", err)
    }
}

// getUsers returns all users
func getUsers(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        users, err := db.GetAllUsers(context.Background())
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        c.JSON(http.StatusOK, gin.H{"data": users})
    }
}

// getUserByID returns a user by ID
func getUserByID(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        idStr := c.Param("id")
        id, err := strconv.Atoi(idStr)
        if err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
            return
        }
        u, err := db.GetUserByID(context.Background(), id)
        if err != nil {
            if errors.Is(err, ErrNotFound) {
                c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
                return
            }
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        c.JSON(http.StatusOK, gin.H{"data": u})
    }
}

// createUser creates a new user
func createUser(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        var body struct {
            Email string `json:"email" binding:"required"`
            Name  string `json:"name" binding:"required"`
        }
        
        if err := c.ShouldBindJSON(&body); err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
            return
        }
        
        u, err := db.CreateUser(context.Background(), &body)
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        c.JSON(http.StatusCreated, gin.H{"data": u})
    }
}

// deleteUser deletes a user by ID
func deleteUser(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        idStr := c.Param("id")
        id, err := strconv.Atoi(idStr)
        if err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
            return
        }
        err = db.DeleteUser(context.Background(), id)
        if err != nil {
            if errors.Is(err, ErrNotFound) {
                c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
                return
            }
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        c.JSON(http.StatusOK, gin.H{"message": "user deleted"})
    }
}
```

**Note:** Replace `database.Client` and all database methods (`GetAllUsers`, `GetUserByID`, `CreateUser`, `DeleteUser`) with your actual database client implementation.

## Advanced Features

### Query Parameters

**GET with filtering/pagination:**

```go
func getUsers(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
        limit, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))
        status := c.Query("status")

        // Build query options (adjust based on your database framework)
        opts := &database.QueryOptions{
            Page:   page,
            Limit:  limit,
            Status: status,
        }

        users, total, err := db.GetUsersWithPagination(context.Background(), opts)
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }

        c.JSON(http.StatusOK, gin.H{
            "data": users,
            "pagination": gin.H{
                "page":  page,
                "limit": limit,
                "total": total,
                "pages": (total + limit - 1) / limit,
            },
        })
    }
}
```

**Note:** Replace `database.Client` and `GetUsersWithPagination` with your actual database client implementation and query methods.

### Authentication Middleware

**Protected endpoint example:**

```go
func authMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        token := c.GetHeader("Authorization")
        if token == "" {
            c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
            c.Abort()
            return
        }
        // Validate token...
        c.Next()
    }
}

// Use middleware
api := r.Group("/api/v1")
api.Use(authMiddleware())
{
    api.GET("/users", getUsers(db))
}
```

### Relations in Responses

**Include related entities:**

```go
func getUsers(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        // Include related entities using your database client
        users, err := db.GetUsersWithTodos(context.Background())
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        c.JSON(http.StatusOK, gin.H{"data": users})
    }
}
```

**Note:** Replace `database.Client` and `GetUsersWithTodos` with your actual database client implementation and methods for loading relations.

## Implementing `update_endpoint` Intent

### Overview

The `update_endpoint` intent allows you to modify existing API endpoints to include additional fields in the response. This is useful for:
- Adding relations to GET endpoints
- Including specific fields from related entities
- Joining on foreign keys to add fields from other entities
- Adding computed fields

### Steps

1. **Read intent** and extract:
   - HTTP method and path of the endpoint to update
   - `updates.add_field` array with field definitions
   - Field source types (`relation`, `field`, `computed`)

2. **Locate the existing endpoint handler** in your codebase

3. **Update the handler** based on field source types:
   - **`type: "relation"`**: Use eager loading (e.g., Ent's `With{Relation}()`)
   - **`type: "field"`**: Join on foreign key and select specific field
   - **`type: "computed"`**: Add computed logic in handler

4. **Update response structure** to include new fields

### Field Source Types

#### Type: `relation` - Include Full Relation

**Use Case:** Include a related entity in the response (e.g., albums for an artist)

**Intent Example:**
```yaml
- kind: update_endpoint
  scope: api
  method: GET
  path: /api/v1/artists
  updates:
    add_field:
      - name: albums
        source:
          type: relation
          relation: albums
```

**Implementation for Ent:**
```go
func getArtists(client *ent.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        // Use WithAlbums() to eager load the albums relation
        artists, err := client.Artist.Query().
            WithAlbums().  // Eager load albums relation
            All(context.Background())
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        c.JSON(http.StatusOK, artists)  // Albums are included in each artist
    }
}
```

**Implementation for GORM:**
```go
func getArtists(db *gorm.DB) gin.HandlerFunc {
    return func(c *gin.Context) {
        var artists []Artist
        err := db.Preload("Albums").Find(&artists).Error
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        c.JSON(http.StatusOK, artists)
    }
}
```

#### Type: `field` - Select Specific Field from Relation

**Use Case:** Include a specific field from a related entity (e.g., album count)

**Intent Example:**
```yaml
- kind: update_endpoint
  scope: api
  method: GET
  path: /api/v1/artists
  updates:
    add_field:
      - name: album_count
        source:
          type: relation
          relation: albums
          entity: Album
          field: count  # Computed count
```

**Implementation:**
```go
func getArtists(client *ent.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        artists, err := client.Artist.Query().
            WithAlbums().
            All(context.Background())
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        
        // Transform response to include computed field
        result := make([]map[string]interface{}, len(artists))
        for i, artist := range artists {
            albums, _ := artist.Edges.AlbumsOrErr()
            result[i] = map[string]interface{}{
                "id":    artist.ID,
                "name":  artist.Name,
                "albums": albums,
                "album_count": len(albums),  // Computed field
            }
        }
        c.JSON(http.StatusOK, result)
    }
}
```

#### Type: `field` with `join` - Join on Foreign Key

**Use Case:** Join on a foreign key and include a field from the joined entity

**Intent Example:**
```yaml
- kind: update_endpoint
  scope: api
  method: GET
  path: /api/v1/albums/{id}
  updates:
    add_field:
      - name: artist_name
        source:
          type: field
          entity: Artist
          field: name
          join:
            foreign_key: artist_id
            target_entity: Artist
            target_field: name
```

**Implementation for Ent:**
```go
func getAlbumByID(client *ent.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        idStr := c.Param("id")
        id, err := uuid.Parse(idStr)
        if err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": "invalid album ID"})
            return
        }
        
        // Use WithArtist() to eager load artist relation
        album, err := client.Album.Query().
            Where(album.IDEQ(id)).
            WithArtist().  // Eager load artist relation
            Only(context.Background())
        if err != nil {
            if ent.IsNotFound(err) {
                c.JSON(http.StatusNotFound, gin.H{"error": "album not found"})
                return
            }
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        
        // Transform to include artist_name field
        artist, _ := album.Edges.ArtistOrErr()
        response := map[string]interface{}{
            "id":    album.ID,
            "title": album.Title,
            "artist_id": album.ArtistID,
            "artist_name": artist.Name,  // Field from joined entity
        }
        c.JSON(http.StatusOK, response)
    }
}
```

**Implementation for GORM:**
```go
func getAlbumByID(db *gorm.DB) gin.HandlerFunc {
    return func(c *gin.Context) {
        idStr := c.Param("id")
        var album Album
        err := db.Preload("Artist").First(&album, "id = ?", idStr).Error
        if err != nil {
            if errors.Is(err, gorm.ErrRecordNotFound) {
                c.JSON(http.StatusNotFound, gin.H{"error": "album not found"})
                return
            }
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        
        response := map[string]interface{}{
            "id":    album.ID,
            "title": album.Title,
            "artist_id": album.ArtistID,
            "artist_name": album.Artist.Name,  // Field from joined entity
        }
        c.JSON(http.StatusOK, response)
    }
}
```

#### Type: `computed` - Add Computed Field

**Use Case:** Add a field that is computed in the handler (not from database)

**Intent Example:**
```yaml
- kind: update_endpoint
  scope: api
  method: GET
  path: /api/v1/artists
  updates:
    add_field:
      - name: total_streams
        source:
          type: computed
```

**Implementation:**
```go
func getArtists(client *ent.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        artists, err := client.Artist.Query().All(context.Background())
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        
        // Transform to include computed field
        result := make([]map[string]interface{}, len(artists))
        for i, artist := range artists {
            // Compute total_streams (example: sum from albums)
            totalStreams := computeTotalStreams(artist.ID)  // Your computation logic
            
            result[i] = map[string]interface{}{
                "id":    artist.ID,
                "name":  artist.Name,
                "total_streams": totalStreams,  // Computed field
            }
        }
        c.JSON(http.StatusOK, result)
    }
}
```

### Complete Example: Updating GET /api/v1/artists

**Intent:**
```yaml
- kind: update_endpoint
  scope: api
  method: GET
  path: /api/v1/artists
  updates:
    add_field:
      - name: albums
        source:
          type: relation
          relation: albums
```

**Before (Original Handler):**
```go
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
```

**After (Updated Handler):**
```go
func getArtists(client *ent.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        // Added WithAlbums() to eager load albums relation
        artists, err := client.Artist.Query().
            WithAlbums().  // Added: Eager load albums relation
            All(context.Background())
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        c.JSON(http.StatusOK, artists)  // Albums are now included in response
    }
}
```

### Best Practices for `update_endpoint`

1. **Use eager loading** for relations to avoid N+1 queries
2. **Transform responses** when adding computed fields or specific fields from relations
3. **Maintain backward compatibility** - existing fields should still be present
4. **Handle errors** when loading relations (use `OrErr()` methods in Ent)
5. **Document changes** in code comments explaining what fields were added
6. **Test thoroughly** to ensure relations load correctly
7. **Consider performance** - eager loading multiple large relations can be slow

### Request Validation

**Using Gin's binding:**

```go
type CreateUserRequest struct {
    Email string `json:"email" binding:"required,email"`
    Name  string `json:"name" binding:"required,min=2,max=100"`
    Age   int    `json:"age" binding:"gte=0,lte=120"`
}

func createUser(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        var req CreateUserRequest
        if err := c.ShouldBindJSON(&req); err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
            return
        }
        // ... create user using db.CreateUser(context.Background(), &req)
    }
}
```

## Status Codes

Use appropriate HTTP status codes:

| Status Code | Usage |
|------------|-------|
| `200` | Successful GET, PATCH, DELETE |
| `201` | Successful POST (created) |
| `400` | Bad request (validation errors) |
| `401` | Unauthorized (not authenticated) |
| `403` | Forbidden (not authorized) |
| `404` | Not found |
| `500` | Internal server error |

## Error Handling Best Practices

1. **Always catch errors** and return proper error responses
2. **Log errors** with `log.Printf()` or structured logging
3. **Use typed error responses** following `api.response.error` config
4. **Validate input** before database operations using `c.ShouldBindJSON()`
5. **Check for existence** before update/delete operations
6. **Return appropriate status codes**
7. **Never expose sensitive error details** to clients
8. **Check for not found errors** using your database framework's error checking (e.g., `errors.Is(err, ErrNotFound)`)

## Common Patterns

### Error Response Helper

```go
func errorResponse(c *gin.Context, status int, message string) {
    c.JSON(status, gin.H{"error": message})
    c.Abort()
}
```

### Success Response Helper

```go
func successResponse(c *gin.Context, status int, data interface{}) {
    c.JSON(status, gin.H{"data": data})
}
```

### ID Parameter Parsing

```go
func parseID(c *gin.Context) (int, error) {
    idStr := c.Param("id")
    id, err := strconv.Atoi(idStr)
    if err != nil {
        return 0, fmt.Errorf("invalid ID: %s", idStr)
    }
    return id, nil
}
```

### UUID Parameter Parsing

```go
import "github.com/google/uuid"

func parseUUID(c *gin.Context) (uuid.UUID, error) {
    idStr := c.Param("id")
    id, err := uuid.Parse(idStr)
    if err != nil {
        return uuid.Nil, fmt.Errorf("invalid UUID: %s", idStr)
    }
    return id, nil
}
```

## Router Setup Patterns

### Basic Setup

```go
r := gin.Default()
r.GET("/health", healthCheck)
api := r.Group("/api/v1")
{
    api.GET("/users", getUsers(db))
}
r.Run(":8080")
```

### With Middleware

```go
r := gin.Default()
r.Use(gin.Logger())
r.Use(gin.Recovery())
r.Use(corsMiddleware())

api := r.Group("/api/v1")
api.Use(authMiddleware())
{
    // Protected routes
}
```

### Production Mode

```go
gin.SetMode(gin.ReleaseMode)
r := gin.New()
r.Use(gin.Recovery())
```

## Best Practices

1. **Follow REST conventions** for method usage
2. **Use handler functions** that return `gin.HandlerFunc`
3. **Structure responses consistently** per `project.yaml` config
4. **Handle errors gracefully** with proper status codes
5. **Validate input** using Gin's binding
6. **Extract path parameters** using `c.Param()`
7. **Use query parameters** for filtering/pagination
8. **Keep handlers focused** - one responsibility per function
9. **Use middleware** for cross-cutting concerns (auth, logging, CORS)
10. **Set production mode** in production: `gin.SetMode(gin.ReleaseMode)`
11. **Use context** for request cancellation and timeouts
12. **Test thoroughly** before deploying

## Testing Endpoints

Use tools like:
- **curl**: `curl http://localhost:8080/api/v1/users`
- **Postman**: Create requests for each endpoint
- **Go tests**: Write automated tests using `net/http/httptest`

Example test:
```go
func TestGetUsers(t *testing.T) {
    router := setupRouter()
    w := httptest.NewRecorder()
    req, _ := http.NewRequest("GET", "/api/v1/users", nil)
    router.ServeHTTP(w, req)

    assert.Equal(t, 200, w.Code)
    assert.Contains(t, w.Body.String(), "data")
}
```

## Database Integration

This template is database framework agnostic. Replace the generic `database.Client` patterns with your actual database client implementation:

- **Ent**: Use `*ent.Client` and Ent's query builder methods
- **GORM**: Use `*gorm.DB` and GORM's query methods
- **Raw SQL**: Use `*sql.DB` and SQL queries
- **Other ORMs**: Adapt the patterns to your chosen framework

The key is to maintain consistent handler function signatures and error handling patterns regardless of the underlying database framework.

