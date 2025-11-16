# Gin Auth Capability Implementation Guide

> **Template Version:** 1.0.0  
> **Compatible OIML Versions:** 0.1.x  
> **Compatible Gin Versions:** 1.9.x, 1.10.x, 1.11.x  
> **Last Updated:** 2025-01-27

This guide provides complete implementation instructions for adding authentication to Gin applications using the `add_capability` intent.

## When to Use This Guide

Use this guide when:

- `api.framework` in `project.yaml` is set to `"gin"`
- An `add_capability` intent with `capability: "auth"` and `framework: "gin"` is being applied
- You need to implement JWT-based authentication for your Gin API

## Prerequisites

- Go 1.18+ is installed
- Gin is installed: `go get github.com/gin-gonic/gin`
- JWT library: `go get github.com/golang-jwt/jwt/v5`
- Password hashing: `go get golang.org/x/crypto/bcrypt`
- Database client is configured (Ent, GORM, or other)

## Overview

The auth capability implements:

- **JWT-based authentication** using `github.com/golang-jwt/jwt/v5`
- **Password hashing** using `golang.org/x/crypto/bcrypt`
- **Middleware** for protecting routes
- **Handlers** for login, register, refresh token, and user info endpoints
- **User entity integration** with your existing database schema

## Intent Structure

```yaml
intents:
  - kind: add_capability
    scope: capability
    capability: auth
    framework: gin
    provider: jwt
    config:
      secret: env:JWT_SECRET
      expiration_hours: 24
      refresh_expiration_hours: 168 # 7 days
    endpoints:
      - method: POST
        path: /api/auth/login
        description: User login endpoint
      - method: POST
        path: /api/auth/register
        description: User registration endpoint
      - method: POST
        path: /api/auth/refresh
        description: Refresh access token
      - method: GET
        path: /api/auth/me
        description: Get current user info
        group: /api/v1/* # Apply auth to all endpoints in /api/v1/* group
```

### Endpoint Group Property

The `group` property allows you to specify which route group should be protected by auth middleware. This is particularly useful when you want to apply authentication to an entire group of endpoints.

**Wildcard Support:**

- Use `*` as a wildcard to match all endpoints in a route group
- Example: `group: /api/v1/*` applies auth middleware to all routes under `/api/v1/`
- Example: `group: /api/*` applies auth middleware to all routes under `/api/`

**Usage Examples:**

```yaml
# Protect all endpoints in /api/v1/* group
endpoints:
  - method: GET
    path: /api/auth/me
    group: /api/v1/*

# Protect specific route groups
endpoints:
  - method: GET
    path: /api/auth/me
    group: /api/v1/users/*
  - method: GET
    path: /api/auth/me
    group: /api/v1/admin/*
```

**Implementation Note:** When a `group` is specified with a wildcard, the auth middleware should be applied to the entire route group in `main.go`, not just individual endpoints. See Step 6 for details.

## Implementation Steps

### Step 1: Verify User Entity

The auth capability requires a `User` entity with at minimum:

- `email` (string, unique, required)
- `password` (string, required) - will store bcrypt hash
- `id` (UUID or integer, primary key)

**If the User entity doesn't exist**, you must first apply an `add_entity` intent:

```yaml
intents:
  - kind: add_entity
    scope: data
    entity: User
    fields:
      - name: id
        type: uuid
        required: true
        default: uuid.New
      - name: email
        type: string
        max_length: 255
        required: true
        unique: true
      - name: password
        type: string
        required: true
```

**If the User entity exists but lacks required fields**, apply an `add_field` intent to add missing fields.

### Step 2: Create Auth Package Structure

Create the auth package directory:

```
api/
├── auth/
│   ├── middleware.go    # JWT middleware
│   ├── handlers.go      # Auth handlers
│   └── utils.go         # Auth utilities (optional)
├── main.go
└── ...
```

### Step 3: Implement JWT Middleware

Create `api/auth/middleware.go`:

```go
package auth

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

var jwtSecret []byte

// InitJWT initializes the JWT secret from environment variable or config
func InitJWT(secret string) {
	if secret == "" {
		panic("JWT_SECRET is required")
	}
	jwtSecret = []byte(secret)
}

// AuthMiddleware validates JWT tokens and sets user context
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			c.Abort()
			return
		}

		// Extract token from "Bearer <token>"
		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid authorization header format"})
			c.Abort()
			return
		}

		tokenString := parts[1]

		// Parse and validate token
		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			// Validate signing method
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return jwtSecret, nil
		})

		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
			c.Abort()
			return
		}

		// Extract claims
		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token claims"})
			c.Abort()
			return
		}

		// Set user ID in context
		userID, ok := claims["user_id"].(string)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID in token"})
			c.Abort()
			return
		}

		c.Set("user_id", userID)
		c.Set("token", token)

		c.Next()
	}
}

// OptionalAuthMiddleware allows requests with or without auth
// Sets user_id in context if token is valid, but doesn't abort if missing
func OptionalAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.Next()
			return
		}

		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.Next()
			return
		}

		tokenString := parts[1]
		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return jwtSecret, nil
		})

		if err == nil && token.Valid {
			if claims, ok := token.Claims.(jwt.MapClaims); ok {
				if userID, ok := claims["user_id"].(string); ok {
					c.Set("user_id", userID)
					c.Set("token", token)
				}
			}
		}

		c.Next()
	}
}
```

### Step 4: Implement Auth Handlers

Create `api/auth/handlers.go`:

```go
package auth

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"your-project/ent"
	"your-project/ent/user"
)

// LoginRequest represents the login request body
type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

// RegisterRequest represents the registration request body
type RegisterRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=8"`
}

// RefreshRequest represents the refresh token request body
type RefreshRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

// AuthResponse represents the authentication response
type AuthResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	User         interface{} `json:"user"`
}

var (
	tokenExpirationHours      = 24
	refreshTokenExpirationHours = 168 // 7 days
)

// InitAuthConfig initializes auth configuration
func InitAuthConfig(expirationHours, refreshExpirationHours int) {
	if expirationHours > 0 {
		tokenExpirationHours = expirationHours
	}
	if refreshExpirationHours > 0 {
		refreshTokenExpirationHours = refreshExpirationHours
	}
}

// generateToken generates a JWT token for a user
func generateToken(userID string, isRefresh bool) (string, error) {
	expirationHours := tokenExpirationHours
	if isRefresh {
		expirationHours = refreshTokenExpirationHours
	}

	claims := jwt.MapClaims{
		"user_id": userID,
		"exp":     time.Now().Add(time.Duration(expirationHours) * time.Hour).Unix(),
		"iat":     time.Now().Unix(),
		"type":    "access",
	}

	if isRefresh {
		claims["type"] = "refresh"
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

// hashPassword hashes a password using bcrypt
func hashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// comparePassword compares a password with a hash
func comparePassword(hashedPassword, password string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(password))
	return err == nil
}

// Login handles user login
func Login(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req LoginRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// Find user by email
		u, err := client.User.Query().
			Where(user.EmailEQ(req.Email)).
			Only(context.Background())
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
			return
		}

		// Verify password
		if !comparePassword(u.Password, req.Password) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
			return
		}

		// Generate tokens
		accessToken, err := generateToken(u.ID.String(), false)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
			return
		}

		refreshToken, err := generateToken(u.ID.String(), true)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate refresh token"})
			return
		}

		// Return response
		c.JSON(http.StatusOK, AuthResponse{
			AccessToken:  accessToken,
			RefreshToken: refreshToken,
			ExpiresIn:    int64(tokenExpirationHours * 3600),
			User:         u,
		})
	}
}

// Register handles user registration
func Register(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req RegisterRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// Check if user already exists
		exists, err := client.User.Query().
			Where(user.EmailEQ(req.Email)).
			Exist(context.Background())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if exists {
			c.JSON(http.StatusConflict, gin.H{"error": "User with this email already exists"})
			return
		}

		// Hash password
		hashedPassword, err := hashPassword(req.Password)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
			return
		}

		// Create user
		u, err := client.User.Create().
			SetEmail(req.Email).
			SetPassword(hashedPassword).
			Save(context.Background())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// Generate tokens
		accessToken, err := generateToken(u.ID.String(), false)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
			return
		}

		refreshToken, err := generateToken(u.ID.String(), true)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate refresh token"})
			return
		}

		// Return response
		c.JSON(http.StatusCreated, AuthResponse{
			AccessToken:  accessToken,
			RefreshToken: refreshToken,
			ExpiresIn:    int64(tokenExpirationHours * 3600),
			User:         u,
		})
	}
}

// Refresh handles token refresh
func Refresh(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req RefreshRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// Parse and validate refresh token
		token, err := jwt.Parse(req.RefreshToken, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return jwtSecret, nil
		})

		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid refresh token"})
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token claims"})
			return
		}

		// Verify it's a refresh token
		if tokenType, ok := claims["type"].(string); !ok || tokenType != "refresh" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token type"})
			return
		}

		userID, ok := claims["user_id"].(string)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID in token"})
			return
		}

		// Generate new access token
		accessToken, err := generateToken(userID, false)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"access_token": accessToken,
			"expires_in":   int64(tokenExpirationHours * 3600),
		})
	}
}

// Me returns the current authenticated user
func Me(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, exists := c.Get("user_id")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
			return
		}

		userIDStr, ok := userID.(string)
		if !ok {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid user ID type"})
			return
		}

		// Parse UUID if using UUID type
		// Adjust based on your User ID type
		u, err := client.User.Query().
			Where(user.IDEQ(userIDStr)). // Adjust based on your ID type
			Only(context.Background())
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
			return
		}

		c.JSON(http.StatusOK, u)
	}
}
```

### Step 5: Update User Entity Schema

Ensure the User entity has a `password` field. If using Ent, add it to `ent/schema/user.go`:

```go
field.String("password").
	Required().
	Sensitive(). // Marks field as sensitive in Ent
	SchemaType(map[string]string{
		"postgres": "varchar(255)",
		"mysql":    "varchar(255)",
		"sqlite3":  "varchar(255)",
	}),
```

**Important:** After adding the password field:

1. Regenerate Ent code: `go generate ./ent` (creates migrations)
2. Apply migrations (only if `database.autorun_migrations` is `true` in `project.yaml`): `client.Schema.Create(context.Background())`

   **CRITICAL:** Before applying migrations, check `project.yaml` for `database.autorun_migrations`:
   - If `database.autorun_migrations: true`: Apply migration automatically
   - If `database.autorun_migrations: false` or not set: Migration is ready but not applied. Apply manually when ready

### Step 6: Register Auth Routes in main.go

**CRITICAL:** Update `main.go` to initialize auth and register routes. Ensure auth initialization happens before route registration.

Update `main.go`:

```go
package main

import (
	"context"
	"log"
	"os"

	"your-project/auth"
	"your-project/ent"
	// ... other imports
)

func main() {
	// ... existing setup code ...

	// Initialize auth - MUST be called before using auth middleware
	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		log.Fatal("JWT_SECRET environment variable is required")
	}
	auth.InitJWT(jwtSecret)

	// Initialize auth config from intent config or defaults
	// Read from intent config if available, otherwise use defaults
	expirationHours := 24        // From intent config.expiration_hours or default
	refreshExpirationHours := 168 // From intent config.refresh_expiration_hours or default
	auth.InitAuthConfig(expirationHours, refreshExpirationHours)

	// Setup Gin router
	r := gin.Default()

	// Auth routes (public - no authentication required)
	authGroup := r.Group("/api/auth")
	{
		authGroup.POST("/login", auth.Login(client))
		authGroup.POST("/register", auth.Register(client))
		authGroup.POST("/refresh", auth.Refresh(client))
	}

	// Protected routes - apply auth middleware to entire group
	// This matches the group: /api/v1/* pattern from the intent
	api := r.Group("/api/v1")
	api.Use(auth.AuthMiddleware()) // Apply auth middleware to all v1 routes
	{
		api.GET("/me", auth.Me(client))
		// ... your existing protected routes ...
		// All routes in this group automatically require authentication
	}

	// ... rest of setup ...
}
```

**IMPORTANT:**

- Auth initialization (`auth.InitJWT()`) must be called before registering routes
- Public auth routes (`/api/auth/*`) should NOT have auth middleware applied
- Protected route groups should have `api.Use(auth.AuthMiddleware())` applied
- Follow the `group` property from intent to determine which routes to protect

**Handling Group Wildcards:**

When the intent specifies a `group` property with a wildcard (e.g., `group: /api/v1/*`), apply the auth middleware to the entire route group:

```go
// If intent specifies group: /api/v1/*
api := r.Group("/api/v1")
api.Use(auth.AuthMiddleware()) // All routes in this group are protected

// If intent specifies group: /api/admin/*
admin := r.Group("/api/admin")
admin.Use(auth.AuthMiddleware()) // All admin routes are protected

// Multiple groups can be protected
apiV1 := r.Group("/api/v1")
apiV1.Use(auth.AuthMiddleware())

apiV2 := r.Group("/api/v2")
apiV2.Use(auth.AuthMiddleware())
```

**Note:** The `group` property in the intent is informational - it tells you which route groups should be protected. You still need to apply the middleware to those groups in your code.

### Step 7: Protect Existing Endpoints

To protect existing endpoints, wrap them with the auth middleware:

```go
// Option 1: Protect entire route group
api := r.Group("/api/v1")
api.Use(auth.AuthMiddleware())
{
	api.GET("/users", getUsers(client))
	api.GET("/users/:id", getUserByID(client))
	// ... all routes in this group require auth
}

// Option 2: Protect individual routes
api.GET("/users", auth.AuthMiddleware(), getUsers(client))

// Option 3: Optional auth (sets user_id if present, but doesn't require it)
api.GET("/posts", auth.OptionalAuthMiddleware(), getPosts(client))
```

### Step 8: Access User Context in Handlers

In protected handlers, access the authenticated user ID:

```go
func getUsers(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Get authenticated user ID
		userID, exists := c.Get("user_id")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
			return
		}

		userIDStr := userID.(string)
		// Use userIDStr in your logic
		// ...
	}
}
```

## Configuration

### Environment Variables

Set the following environment variable:

```bash
JWT_SECRET=your-secret-key-here-minimum-32-characters
```

**Security Note:** Use a strong, random secret key. Generate one with:

```bash
openssl rand -base64 32
```

### Intent Configuration Options

The `config` object in the intent supports:

- `secret`: JWT secret (can use `env:JWT_SECRET` format)
- `expiration_hours`: Access token expiration in hours (default: 24)
- `refresh_expiration_hours`: Refresh token expiration in hours (default: 168)

## Testing

### Register a User

```bash
curl -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

### Login

```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

### Access Protected Endpoint

```bash
curl -X GET http://localhost:8080/api/v1/me \
  -H "Authorization: Bearer <access_token>"
```

### Refresh Token

```bash
curl -X POST http://localhost:8080/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "<refresh_token>"
  }'
```

## Security Best Practices

1. **Password Requirements**: Enforce minimum password length (8+ characters) in registration handler
2. **HTTPS**: Always use HTTPS in production - JWT tokens in Authorization headers are sensitive
3. **Token Storage**: Store tokens securely (httpOnly cookies recommended for web apps, secure storage for mobile)
4. **Token Expiration**: Use short-lived access tokens (24 hours) and longer refresh tokens (7 days)
5. **Secret Management**: Never commit JWT secrets to version control - use environment variables
6. **Password Hashing**: Always use bcrypt with appropriate cost (default is fine)
7. **Rate Limiting**: Implement rate limiting on login/register endpoints to prevent brute force attacks
8. **CORS**: Configure CORS properly for your frontend domain
9. **Error Messages**: Don't reveal whether email exists or not - use generic "Invalid email or password" messages
10. **Response Format**: Follow `api.response` configuration from `project.yaml` for all error responses
11. **Logging**: Log authentication failures for security monitoring, but don't expose details to clients

## Troubleshooting

### "JWT_SECRET is required" error

**Solution:**

- Ensure `JWT_SECRET` environment variable is set in your environment
- Check that `auth.InitJWT()` is called before using auth middleware
- Verify `auth.InitJWT()` is called in `main.go` before route registration

### "Invalid or expired token" error

**Solution:**

- Check that token hasn't expired (verify expiration time in token claims)
- Verify token is sent in correct format: `Authorization: Bearer <token>` (with space after "Bearer")
- Ensure `JWT_SECRET` matches between token generation and validation
- Check that token was generated with the same secret used for validation
- Verify token signing method matches (HS256)

### "User not found" in Me endpoint

**Solution:**

- Verify user ID type matches (UUID vs string) - check token claims match database ID type
- Check that user exists in database - token may reference deleted user
- Ensure middleware is applied before handler - verify `api.Use(auth.AuthMiddleware())` is called
- Check that `user_id` is set in context by middleware - verify `c.Get("user_id")` returns value

### Middleware not protecting routes

**Solution:**

- Verify `auth.AuthMiddleware()` is applied to route groups: `api.Use(auth.AuthMiddleware())`
- Check that `auth.InitJWT()` was called before middleware usage
- Ensure middleware is applied to the correct route groups based on intent `group` property
- Verify public routes (`/api/auth/*`) do NOT have auth middleware applied

## Next Steps

After implementing auth:

1. Add role-based access control (RBAC) if needed
2. Implement password reset functionality
3. Add email verification
4. Implement logout (token blacklisting)
5. Add rate limiting to auth endpoints
