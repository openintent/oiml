import { HEADER, goFile } from "./util.js";

/** generated/jobs/jobs.go: queued events as River jobs on the same database. Static. */
export function jobsFile(modulePath: string): string {
  return goFile(
    modulePath,
    HEADER("Background jobs on River: queued events are stored in Postgres and run by the worker with retries."),
    "jobs",
    [
      "context",
      "encoding/json",
      "errors",
      "os",
      "sync",
      "github.com/jackc/pgx/v5",
      "github.com/jackc/pgx/v5/pgxpool",
      "github.com/riverqueue/river",
      "github.com/riverqueue/river/riverdriver/riverpgxv5",
      "github.com/riverqueue/river/rivermigrate"
    ],
    `// Runner runs the queued handlers of an event; the events package provides it.
type Runner func(ctx context.Context, name string, payload json.RawMessage) error

// EventArgs is the job of a queued event: its name and the presented payload.
type EventArgs struct {
	Name    string          \`json:"name"\`
	Payload json.RawMessage \`json:"payload"\`
}

// Kind names the job in River's tables.
func (EventArgs) Kind() string {
	return "osl_event"
}

// InsertOpts retries a failed event three times (four attempts in all) with River's exponential backoff.
func (EventArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{MaxAttempts: 4}
}

type eventWorker struct {
	river.WorkerDefaults[EventArgs]
	run Runner
}

func (w *eventWorker) Work(ctx context.Context, job *river.Job[EventArgs]) error {
	return w.run(ctx, job.Args.Name, job.Args.Payload)
}

// Role reads OSL_ROLE: web only answers requests and enqueues; worker only runs jobs; all (default) does both in one process.
func Role() string {
	switch role := os.Getenv("OSL_ROLE"); role {
	case "web", "worker":
		return role
	}
	return "all"
}

var current struct {
	sync.Mutex
	client *river.Client[pgx.Tx]
}

// Start applies River's migrations and builds the client: insert-only in the web role, working jobs otherwise.
func Start(ctx context.Context, pool *pgxpool.Pool, run Runner) error {
	driver := riverpgxv5.New(pool)
	migrator, err := rivermigrate.New(driver, nil)
	if err != nil {
		return err
	}
	if _, err := migrator.Migrate(ctx, rivermigrate.DirectionUp, nil); err != nil {
		return err
	}
	config := &river.Config{}
	if Role() != "web" {
		workers := river.NewWorkers()
		river.AddWorker(workers, &eventWorker{run: run})
		config.Workers = workers
		config.Queues = map[string]river.QueueConfig{river.QueueDefault: {MaxWorkers: 10}}
	}
	client, err := river.NewClient(driver, config)
	if err != nil {
		return err
	}
	if Role() != "web" {
		if err := client.Start(ctx); err != nil {
			return err
		}
	}
	current.Lock()
	defer current.Unlock()
	current.client = client
	return nil
}

// Enqueue stores an event to run in the background.
func Enqueue(ctx context.Context, name string, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	current.Lock()
	client := current.client
	current.Unlock()
	if client == nil {
		return errors.New("jobs are not started: call app.Start first")
	}
	_, err = client.Insert(ctx, EventArgs{Name: name, Payload: data}, nil)
	return err
}

// Stop lets running jobs finish and stops the client.
func Stop(ctx context.Context) error {
	current.Lock()
	client := current.client
	current.client = nil
	current.Unlock()
	if client == nil || Role() == "web" {
		return nil
	}
	return client.Stop(ctx)
}
`
  );
}
