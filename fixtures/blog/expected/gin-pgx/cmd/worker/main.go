// Created once by OSL (@osl/backend-gin-pgx). Runs queued events and nothing else (OSL_ROLE=worker); stop it with SIGINT or SIGTERM.
// You own this file: OSL never rewrites it.

package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"blog/generated/app"
	"blog/generated/db"
)

func main() {
	if err := os.Setenv("OSL_ROLE", "worker"); err != nil {
		log.Fatal(err)
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
	log.Print("worker running")
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	if err := app.Stop(ctx); err != nil {
		log.Printf("stop: %v", err)
	}
}
