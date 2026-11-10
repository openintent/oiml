import type { GeneratedFile, IR } from "@osl/core";
import { globalActions } from "@osl/core";
import { hasScheduling } from "./scheduling.js";
import { HEADER, SCAFFOLD_HEADER, exported, goFile } from "./util.js";

/** generated/openapi.go: the OpenAPI document next to it, embedded so the binary serves it from anywhere. */
export function openapiFile(modulePath: string): string {
  return goFile(
    modulePath,
    HEADER("The OpenAPI document of the REST contract, embedded from openapi.json."),
    "generated",
    ["embed"],
    `// OpenAPI is generated/openapi.json: the REST contract as OpenAPI 3.1, served at GET /api/openapi.json.
//
//go:embed openapi.json
var OpenAPI []byte
`
  ).replace('import "embed"', 'import _ "embed"');
}

/** generated/app/app.go: builds the Gin engine with every route, and starts or stops the background work. */
export function appFile(ir: IR, modulePath: string): string {
  const imports = [
    "context",
    "net/http",
    "github.com/gin-gonic/gin",
    "github.com/jackc/pgx/v5/pgxpool",
    `${modulePath}/generated`,
    `${modulePath}/generated/auth`
  ];
  const globals = globalActions(ir).filter(a => a.rule.kind !== "none");
  if (ir.resources.length || globals.length) imports.push(`${modulePath}/generated/resources`);
  if (ir.files) imports.push(`${modulePath}/generated/filesapi`);
  if (ir.jobs) imports.push(`${modulePath}/generated/events`, `${modulePath}/generated/jobs`);
  const scheduling = hasScheduling(ir);
  if (scheduling) imports.push(`${modulePath}/generated/scheduling`);
  imports.push("os", `${modulePath}/generated/testhooks`);
  // Under isolation: database requests go through the app role's pool, each with its own binding; the owner's pool is the worker's
  const isolated = Boolean(ir.auth?.tenancy?.isolation);
  if (isolated) imports.push(`${modulePath}/generated/db`);
  const requests = isolated ? "requests" : "pool";
  const registrations: string[] = [];
  if (scheduling) registrations.push(`\tscheduling.Use(pool)`);
  if (ir.files) registrations.push(`\tfilesapi.New(${requests}, a).Routes(r)`);
  for (const resource of ir.resources)
    registrations.push(`\tresources.New${exported(resource.name)}(${requests}, a).Routes(r)`);
  if (globals.length) registrations.push(`\tresources.NewGlobalActions(${requests}, a).Routes(r)`);
  registrations.push(
    `\tif os.Getenv("OSL_TEST_HOOKS") == "1" {\n\t\ttesthooks.Routes(r${isolated ? ", requests" : ""})\n\t}`
  );
  const scope = isolated
    ? `	// Requests read and write as the app role, which the tenant policies bind; New refuses any other
	requests, err := db.ConnectApp(context.Background())
	if err != nil {
		panic(err)
	}
	r.Use(func(c *gin.Context) {
		c.Request = c.Request.WithContext(db.WithBinding(c.Request.Context()))
		c.Next()
	})
`
    : "";
  const start = ir.jobs
    ? `// Start runs the background work: River's migrations and, unless OSL_ROLE is web, the worker for queued events, schedules and timers.
func Start(ctx context.Context, pool *pgxpool.Pool) error {
	${scheduling ? "scheduling.Use(pool)\n\treturn jobs.Start(ctx, pool, events.RunQueued, scheduling.Periodic(), scheduling.RunTimerJob)" : "return jobs.Start(ctx, pool, events.RunQueued, nil, nil)"}
}

// Stop lets running jobs finish.
func Stop(ctx context.Context) error {
	return jobs.Stop(ctx)
}`
    : `// Start runs the background work; the model queues no events, so there is none.
func Start(ctx context.Context, pool *pgxpool.Pool) error {
	return nil
}

// Stop ends the background work.
func Stop(ctx context.Context) error {
	return nil
}`;
  return goFile(
    modulePath,
    HEADER("The HTTP application: every generated route on one Gin engine."),
    "app",
    imports,
    `// New builds the engine. Add your own middleware and routes to the result in cmd/server.${isolated ? "\n// pool is the owner's (DATABASE_URL): the worker's jobs act through it. Requests use the app role's (DATABASE_APP_URL)." : ""}
func New(pool *pgxpool.Pool) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())
${scope}	r.GET("/healthz", healthz)
	r.GET("/api/openapi.json", openapi)
	a := auth.New(${requests})
	a.Routes(r)
${registrations.join("\n")}${registrations.length ? "\n" : ""}	return r
}

${start}

func healthz(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func openapi(c *gin.Context) {
	c.Data(http.StatusOK, "application/json", generated.OpenAPI)
}
`
  );
}

/** cmd/server/main.go: the entry point, created once. */
export function mainScaffold(modulePath: string): GeneratedFile {
  return {
    path: "cmd/server/main.go",
    mode: "scaffold",
    content: goFile(
      modulePath,
      SCAFFOLD_HEADER("Starts the HTTP server on PORT (default 8080)."),
      "main",
      ["context", "log", "os", "github.com/gin-gonic/gin", `${modulePath}/generated/app`, `${modulePath}/generated/db`],
      `func main() {
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
`
    )
  };
}

/** cmd/worker/main.go: a process that only runs queued events, created once when the model queues any. */
export function workerScaffold(modulePath: string): GeneratedFile {
  return {
    path: "cmd/worker/main.go",
    mode: "scaffold",
    content: goFile(
      modulePath,
      SCAFFOLD_HEADER("Runs queued events and nothing else (OSL_ROLE=worker); stop it with SIGINT or SIGTERM."),
      "main",
      ["context", "log", "os", "os/signal", "syscall", `${modulePath}/generated/app`, `${modulePath}/generated/db`],
      `func main() {
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
`
    )
  };
}
