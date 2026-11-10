// Created once by OSL (@osl/backend-gin-pgx). Starts the HTTP server on PORT (default 8080).
// You own this file: OSL never rewrites it.

package main

import (
	"context"
	"log"
	"os"

	"github.com/gin-gonic/gin"

	"music/generated/app"
	"music/generated/db"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	if os.Getenv("GIN_MODE") == "" {
		gin.SetMode(gin.ReleaseMode)
	}
	ctx := context.Background()
	pool, err := db.Connect(ctx)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer pool.Close()
	if err := app.Start(ctx, pool); err != nil {
		log.Fatalf("start: %v", err)
	}
	defer app.Stop(ctx)
	log.Printf("listening on :%s", port)
	if err := app.New(pool).Run(":" + port); err != nil {
		log.Fatal(err)
	}
}
