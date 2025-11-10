package auth

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"streamify/ent"
	"streamify/ent/user"
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
	AccessToken  string      `json:"access_token"`
	RefreshToken string      `json:"refresh_token"`
	ExpiresIn    int64       `json:"expires_in"`
	User         interface{} `json:"user"`
}

var (
	tokenExpirationHours        = 24
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

		// Check if user has a password set
		// Note: After regenerating Ent code with optional password, Password will be *string
		// For now, Password is string - check if empty
		if u.Password == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "User account not properly set up. Please register or reset password."})
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
		// Note: After regenerating Ent code with optional password, use SetNillablePassword
		// For now, use SetPassword
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

		// Parse UUID
		userUUID, err := uuid.Parse(userIDStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID format"})
			return
		}

		u, err := client.User.Query().
			Where(user.IDEQ(userUUID)).
			Only(context.Background())
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
			return
		}

		c.JSON(http.StatusOK, u)
	}
}
