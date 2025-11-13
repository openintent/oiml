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

| Intent Path      | Route Pattern                | Handler Function      |
| ---------------- | ---------------------------- | --------------------- |
| `/api/users`     | `api.GET("/users", ...)`     | `getUsers(client)`    |
| `/api/users/:id` | `api.GET("/users/:id", ...)` | `getUserByID(client)` |
| `/api/posts`     | `api.GET("/posts", ...)`     | `getPosts(client)`    |

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
   - `api.response.success.object` (e.g., `"data"`) - **CRITICAL:** Use this for success response wrapper
   - `api.response.error.object` (e.g., `"error"`) - **CRITICAL:** Use this for error response wrapper
   - `paths.api` (default: `"api"` or router location) - Verify this directory exists
   - `database.framework` (e.g., `"ent"`, `"gorm"`) - Required for database queries
   - `paths.types` (if applicable) - Location for Go types/interfaces

   **IMPORTANT:** If `api.response` is not configured in `project.yaml`, use defaults:
   - Success: `gin.H{"data": ...}`
   - Error: `gin.H{"error": "..."}`

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

**CRITICAL:** Always follow `api.response` configuration from `project.yaml`. If not configured, use defaults below.

**Configuration Example:**

```yaml
api:
  response:
    success:
      object: data # Success responses wrap result in "data" field
    error:
      object: error # Error responses use "error" field
```

**Success Response Format:**

```go
// If api.response.success.object is "data":
gin.H{
    "data": [...results...]  // Array for GET all, single object for GET by ID/POST
}

// If api.response.success.object is "result":
gin.H{
    "result": [...results...]
}
```

**Error Response Format:**

```go
// If api.response.error.object is "error":
gin.H{
    "error": "Error message"
}

// If api.response.error.object is "message":
gin.H{
    "message": "Error message"
}
```

**Default (if api.response not configured):**

```go
// Success
gin.H{"data": ...}

// Error
gin.H{"error": "..."}
```

**IMPORTANT:** Always check `project.yaml` for `api.response` configuration before generating response structures. Use consistent response format across all endpoints.

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

**Generic Implementation:**

```go
func getArtists(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        // Use your database client's eager loading method for relations
        artists, err := db.GetArtistsWithAlbums(context.Background())
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        c.JSON(http.StatusOK, gin.H{"data": artists})  // Albums are included in each artist
    }
}
```

**Note:** Consult your database framework guide (e.g., Ent, Prisma) for specific eager loading syntax and methods for including relations in queries.

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
          field: count # Computed count
```

**Generic Implementation:**

```go
func getArtists(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        // Query artists with albums relation loaded
        artists, err := db.GetArtistsWithAlbums(context.Background())
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }

        // Transform response to include computed field
        result := make([]map[string]interface{}, len(artists))
        for i, artist := range artists {
            result[i] = map[string]interface{}{
                "id":          artist.ID,
                "name":        artist.Name,
                "albums":      artist.Albums,
                "album_count": len(artist.Albums),  // Computed field
            }
        }
        c.JSON(http.StatusOK, gin.H{"data": result})
    }
}
```

**Note:** Consult your database framework guide for specific methods to load relations and access related data.

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

**Generic Implementation:**

```go
func getAlbumByID(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        idStr := c.Param("id")
        id, err := parseID(idStr)  // Use appropriate ID parsing for your ID type
        if err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": "invalid album ID"})
            return
        }

        // Query album with artist relation loaded
        album, err := db.GetAlbumByIDWithArtist(context.Background(), id)
        if err != nil {
            if errors.Is(err, ErrNotFound) {
                c.JSON(http.StatusNotFound, gin.H{"error": "album not found"})
                return
            }
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }

        // Transform to include artist_name field from joined entity
        response := map[string]interface{}{
            "id":          album.ID,
            "title":       album.Title,
            "artist_id":   album.ArtistID,
            "artist_name": album.Artist.Name,  // Field from joined entity
        }
        c.JSON(http.StatusOK, gin.H{"data": response})
    }
}
```

**Note:** Consult your database framework guide for specific methods to join tables and access fields from related entities.

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

**Generic Implementation:**

```go
func getArtists(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        artists, err := db.GetAllArtists(context.Background())
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
                "id":            artist.ID,
                "name":          artist.Name,
                "total_streams": totalStreams,  // Computed field
            }
        }
        c.JSON(http.StatusOK, gin.H{"data": result})
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
func getArtists(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        artists, err := db.GetAllArtists(context.Background())
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        c.JSON(http.StatusOK, gin.H{"data": artists})
    }
}
```

**After (Updated Handler):**

```go
func getArtists(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        // Updated to use method that eager loads albums relation
        artists, err := db.GetArtistsWithAlbums(context.Background())
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        c.JSON(http.StatusOK, gin.H{"data": artists})  // Albums are now included in response
    }
}
```

**Note:** Consult your database framework guide for specific eager loading patterns and syntax.

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

| Status Code | Usage                            |
| ----------- | -------------------------------- |
| `200`       | Successful GET, PATCH, DELETE    |
| `201`       | Successful POST (created)        |
| `400`       | Bad request (validation errors)  |
| `401`       | Unauthorized (not authenticated) |
| `403`       | Forbidden (not authorized)       |
| `404`       | Not found                        |
| `500`       | Internal server error            |

## Error Handling Best Practices

1. **Always catch errors** and return proper error responses following `api.response.error` format
2. **Log errors** with `log.Printf()` or structured logging - include full error details in logs
3. **Use typed error responses** - ensure error format matches `api.response.error` config
4. **Validate input** before database operations using `c.ShouldBindJSON()` - return 400 for validation errors
5. **Check for existence** before update/delete operations - return 404 if not found
6. **Return appropriate status codes**:
   - `200` - Successful GET, PATCH, DELETE
   - `201` - Successful POST (created)
   - `400` - Bad request (validation errors)
   - `401` - Unauthorized (not authenticated)
   - `403` - Forbidden (not authorized)
   - `404` - Not found
   - `409` - Conflict (e.g., duplicate email)
   - `500` - Internal server error
7. **Never expose sensitive error details** to clients - sanitize error messages
8. **Check for not found errors** using your database framework's error checking:
   - Ent: `ent.IsNotFound(err)`
   - GORM: `errors.Is(err, gorm.ErrRecordNotFound)`
   - Custom: `errors.Is(err, ErrNotFound)`
9. **Handle database constraint violations** appropriately:
   - Unique constraint violations → 409 Conflict
   - Foreign key violations → 400 Bad Request
   - Other database errors → 500 Internal Server Error

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

## Handling Data Intent Side Effects on APIs

When data intents (`remove_entity`, `rename_entity`, `rename_field`) are applied to the database schema, API endpoints that reference those entities or fields **must be updated** to prevent breakage. This section provides guidance on handling these side effects.

### `remove_entity` Intent - API Impact

**Impact:** Any endpoint that uses the removed entity will break.

**Steps to Handle:**

1. **Identify affected endpoints**:
   - Search for handler functions that reference the entity
   - Check for:
     - Route registrations (e.g., `api.GET("/customers", ...)`)
     - Handler function names (e.g., `getCustomers`, `createCustomer`)
     - Database client calls (e.g., `client.Customer.Query()`, `db.GetAllCustomers()`)
     - Struct definitions for the entity

2. **Delete or deprecate endpoints**:
   - **Option A - Delete immediately**: Remove handler functions and route registrations
   - **Option B - Soft deprecation**: Return 410 Gone status:
     ```go
     func getCustomers(db *database.Client) gin.HandlerFunc {
         return func(c *gin.Context) {
             c.JSON(http.StatusGone, gin.H{
                 "error": "This endpoint has been removed. The Customer resource is no longer available.",
             })
         }
     }
     ```

3. **Remove route registrations** from router setup:

   ```go
   // REMOVE these lines from main.go or router setup:
   // api.GET("/customers", getCustomers(db))
   // api.GET("/customers/:id", getCustomerByID(db))
   // api.POST("/customers", createCustomer(db))
   ```

4. **Update dependent endpoints**:
   - If other entities have relations to the removed entity, update those handlers
   - Remove eager loading for the removed relation (e.g., `WithCustomer()` in Ent)
   - Update response structs to remove customer fields

### Example: Handling `remove_entity` for Customer

**Intent:**

```yaml
- kind: remove_entity
  scope: data
  entity: Customer
  cascade: false
```

**Actions:**

1. **Remove handler functions** from codebase:

```go
// DELETE these functions:
// func getCustomers(db *database.Client) gin.HandlerFunc { ... }
// func getCustomerByID(db *database.Client) gin.HandlerFunc { ... }
// func createCustomer(db *database.Client) gin.HandlerFunc { ... }
// func updateCustomer(db *database.Client) gin.HandlerFunc { ... }
// func deleteCustomer(db *database.Client) gin.HandlerFunc { ... }
```

2. **Remove route registrations** from router:

```go
// main.go - REMOVE these lines:
// api.GET("/customers", getCustomers(db))
// api.GET("/customers/:id", getCustomerByID(db))
// api.POST("/customers", createCustomer(db))
// api.PATCH("/customers/:id", updateCustomer(db))
// api.DELETE("/customers/:id", deleteCustomer(db))
```

3. **Update related endpoints** (if Order entity had a customer relation):

**Before:**

```go
func getOrders(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        // Query includes customer relation (will break after Customer is removed)
        orders, err := db.GetOrdersWithCustomer(context.Background())
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        c.JSON(http.StatusOK, gin.H{"data": orders})
    }
}
```

**After:**

```go
func getOrders(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        // Remove customer relation - entity no longer exists
        orders, err := db.GetAllOrders(context.Background())
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        c.JSON(http.StatusOK, gin.H{"data": orders})
    }
}
```

**Note:** Consult your database framework guide for specific methods to query with or without relations.

### `rename_entity` Intent - API Impact

**Impact:** Route paths, handler function names, database queries, and type definitions need updates.

**Steps to Handle:**

1. **Update route registrations**:
   - From: `api.GET("/customers", ...)`
   - To: `api.GET("/clients", ...)`

2. **Rename handler functions** (optional but recommended):
   - From: `getCustomers`, `createCustomer`
   - To: `getClients`, `createClient`

3. **Update database client calls**:
   - Update method names: `GetAllCustomers()` → `GetAllClients()`
   - Update entity references in query methods
   - Update struct names and type references

4. **Update all references** in other endpoints:
   - Update relation loading methods (e.g., `GetOrdersWithCustomer()` → `GetOrdersWithClient()`)
   - Update field accesses for related entities

**Note:** Consult your database framework guide for specific patterns when renaming entities in queries and relations.

### Example: Handling `rename_entity` from Customer to Client

**Intent:**

```yaml
- kind: rename_entity
  scope: data
  from: Customer
  to: Client
```

**Actions:**

1. **Update route registrations** in router:

**Before:**

```go
api.GET("/customers", getCustomers(db))
api.GET("/customers/:id", getCustomerByID(db))
api.POST("/customers", createCustomer(db))
```

**After:**

```go
api.GET("/clients", getClients(db))
api.GET("/clients/:id", getClientByID(db))
api.POST("/clients", createClient(db))
```

2. **Rename and update handler functions**:

**Before:**

```go
func getCustomers(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        customers, err := db.GetAllCustomers(context.Background())
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        c.JSON(http.StatusOK, gin.H{"data": customers})
    }
}
```

**After:**

```go
func getClients(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        clients, err := db.GetAllClients(context.Background())
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        c.JSON(http.StatusOK, gin.H{"data": clients})
    }
}
```

3. **Update request body structs** (if defined inline):

**Before:**

```go
func createCustomer(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        var body struct {
            Email string `json:"email" binding:"required"`
            Name  string `json:"name" binding:"required"`
        }
        // ... rest of handler with db.CreateCustomer()
    }
}
```

**After:**

```go
func createClient(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        var body struct {
            Email string `json:"email" binding:"required"`
            Name  string `json:"name" binding:"required"`
        }
        // ... rest of handler with db.CreateClient() (struct fields stay the same, only entity name changes)
    }
}
```

### `rename_field` Intent - API Impact

**Impact:** Request validation, database queries, and response transformations need field name updates.

**Steps to Handle:**

1. **Update request body structs**:
   - Update JSON tags: `json:"name"` → `json:"full_name"`
   - Update struct field names if they match

2. **Update database client calls**:
   - Update method parameters for create/update operations
   - Field names in database operations must match new field name

3. **Update response transformations**:
   - If you're manually building response maps, update field names

4. **Update field validation**:
   - Update binding tags and error messages

**Note:** Consult your database framework guide for specific patterns when renaming fields in queries and mutations.

### Example: Handling `rename_field` from 'name' to 'full_name'

**Intent:**

```yaml
- kind: rename_field
  scope: data
  entity: Customer
  from: name
  to: full_name
```

**Actions:**

1. **Update POST handler**:

**Before:**

```go
func createCustomer(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        var body struct {
            Email string `json:"email" binding:"required"`
            Name  string `json:"name" binding:"required"`  // Old field name
        }

        if err := c.ShouldBindJSON(&body); err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
            return
        }

        customer, err := db.CreateCustomer(context.Background(), body.Email, body.Name)
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }

        c.JSON(http.StatusCreated, gin.H{"data": customer})
    }
}
```

**After:**

```go
func createCustomer(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        var body struct {
            Email    string `json:"email" binding:"required"`
            FullName string `json:"full_name" binding:"required"`  // New field name
        }

        if err := c.ShouldBindJSON(&body); err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
            return
        }

        customer, err := db.CreateCustomer(context.Background(), body.Email, body.FullName)
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }

        c.JSON(http.StatusCreated, gin.H{"data": customer})
    }
}
```

2. **Update PATCH handler**:

**Before:**

```go
func updateCustomer(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        idStr := c.Param("id")
        id, err := strconv.Atoi(idStr)
        if err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": "invalid customer ID"})
            return
        }

        var body struct {
            Email *string `json:"email"`
            Name  *string `json:"name"`  // Old field name
        }

        if err := c.ShouldBindJSON(&body); err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
            return
        }

        // Build update with fields that are provided
        updateData := make(map[string]interface{})
        if body.Email != nil {
            updateData["email"] = *body.Email
        }
        if body.Name != nil {
            updateData["name"] = *body.Name  // Old field
        }

        customer, err := db.UpdateCustomer(context.Background(), id, updateData)
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }

        c.JSON(http.StatusOK, gin.H{"data": customer})
    }
}
```

**After:**

```go
func updateCustomer(db *database.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        idStr := c.Param("id")
        id, err := strconv.Atoi(idStr)
        if err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": "invalid customer ID"})
            return
        }

        var body struct {
            Email    *string `json:"email"`
            FullName *string `json:"full_name"`  // New field name
        }

        if err := c.ShouldBindJSON(&body); err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
            return
        }

        // Build update with fields that are provided
        updateData := make(map[string]interface{})
        if body.Email != nil {
            updateData["email"] = *body.Email
        }
        if body.FullName != nil {
            updateData["full_name"] = *body.FullName  // New field
        }

        customer, err := db.UpdateCustomer(context.Background(), id, updateData)
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }

        c.JSON(http.StatusOK, gin.H{"data": customer})
    }
}
```

3. **Update response transformations** (if manually building responses):

**Before:**

```go
result := map[string]interface{}{
    "id":    customer.ID,
    "email": customer.Email,
    "name":  customer.Name,  // Old field
}
```

**After:**

```go
result := map[string]interface{}{
    "id":        customer.ID,
    "email":     customer.Email,
    "full_name": customer.FullName,  // New field
}
```

### Best Practices for Handling Data Intent Side Effects

1. **Search globally** for entity/field references before making changes
2. **Use Go's type system** - compilation errors will guide you to affected code
3. **Test all affected endpoints** after updates
4. **Consider API versioning** for breaking changes (e.g., `/api/v1/` vs `/api/v2/`)
5. **Document breaking changes** in API changelog
6. **Use deprecation periods** for public APIs rather than immediate removal
7. **Update API documentation** (Swagger/OpenAPI specs) alongside code changes
8. **Check for hardcoded strings** - search for entity/field names in string literals
9. **Update tests** for affected endpoints
10. **Coordinate with frontend** teams if endpoints are consumed by UI
11. **Regenerate database client** according to your database framework's instructions before updating API handlers
12. **Update middleware** if entity names are used in logging, caching, or auth logic

**Note:** Consult your database framework guide for specific regeneration commands and patterns when schema changes occur.

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
13. **Handle data intent side effects** - when entities/fields are removed or renamed, update all affected API endpoints

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

  ```go
  import "your-project/ent"

  func getUsers(client *ent.Client) gin.HandlerFunc {
      return func(c *gin.Context) {
          users, err := client.User.Query().All(context.Background())
          if err != nil {
              if ent.IsNotFound(err) {
                  c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
                  return
              }
              c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
              return
          }
          c.JSON(http.StatusOK, gin.H{"data": users})
      }
  }
  ```

- **GORM**: Use `*gorm.DB` and GORM's query methods

  ```go
  import "gorm.io/gorm"

  func getUsers(db *gorm.DB) gin.HandlerFunc {
      return func(c *gin.Context) {
          var users []User
          if err := db.Find(&users).Error; err != nil {
              if errors.Is(err, gorm.ErrRecordNotFound) {
                  c.JSON(http.StatusNotFound, gin.H{"error": "Users not found"})
                  return
              }
              c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
              return
          }
          c.JSON(http.StatusOK, gin.H{"data": users})
      }
  }
  ```

- **Raw SQL**: Use `*sql.DB` and SQL queries
- **Other ORMs**: Adapt the patterns to your chosen framework

**IMPORTANT:**

- Always handle database errors appropriately
- Use framework-specific error checking methods
- Maintain consistent handler function signatures and error handling patterns regardless of the underlying database framework
- Follow `api.response` configuration for all responses
