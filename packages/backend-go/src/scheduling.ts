import type { ActionIR, EntityIR, IR, ScheduleIR, TimerIR } from "@osl/core";
import { columnsConst, scanFunc, tableConst } from "./models.js";
import { HEADER, column, entityByName, exported, goFile, q, quoteIdent, rowGoType, typeName } from "./util.js";
import { actionInputType } from "./actions.js";

export function hasScheduling(ir: IR): boolean {
  return ir.schedules.length > 0 || ir.timers.length > 0;
}

function actionOf(ir: IR, run: ScheduleIR["run"]): ActionIR {
  return ir.actions.find(a => a.name === run.action && (run.resource ? a.resource === run.resource : !a.resource))!;
}

/** A Go literal of a schedule's input value */
function goLiteral(value: string | number | boolean): string {
  return typeof value === "string" ? q(value) : String(value);
}

/** The statement that runs an action's handler as the system and answers its error */
function runStatement(action: ActionIR, args: string): string {
  const call = `handlers.${exported(action.handler)}(${args})`;
  return action.returns.kind === "none" ? `return ${call}` : `_, err := ${call}\n\treturn err`;
}

/** A Go expression comparing `field` (a pointer when `pointer`) with a condition literal */
function compareExpr(field: string, pointer: boolean, when: NonNullable<TimerIR["when"]>): string {
  if (when.value === null) return `${field} ${when.op === "eq" ? "==" : "!="} nil`;
  const literal = typeof when.value === "string" ? q(when.value) : String(when.value);
  if (!pointer) return `${field} ${when.op === "eq" ? "==" : "!="} ${literal}`;
  return when.op === "eq" ? `${field} != nil && *${field} == ${literal}` : `${field} == nil || *${field} != ${literal}`;
}

/**
 * The body of a timer's holds function: a comparison on the row's own column, or, for a condition through a
 * relation, one query per hop down to the value it reaches, compared as a pointer (missing rows are nil).
 */
function holdsBody(ir: IR, timer: TimerIR, entity: EntityIR): string {
  const when = timer.when;
  if (!when) return "\t_, _ = ctx, row\n\treturn true, nil";
  const hops = when.via ?? [];
  if (hops.length === 0) {
    const col = entity.columns.find(c => c.name === when.column)!;
    return `\t_ = ctx\n\treturn ${compareExpr(`row.${exported(when.column)}`, rowGoType(col).startsWith("*"), when)}, nil`;
  }
  const lines: string[] = [];
  let source = `row.${exported(hops[0].column)}`;
  hops.forEach((hop, i) => {
    const hopEntity = entityByName(ir, hop.entity);
    const next = i + 1 < hops.length ? hops[i + 1].column : when.column;
    const type = rowGoType({ ...column(hopEntity, next), nullable: false });
    const v = `v${i}`;
    lines.push(`\tvar ${v} *${type}`);
    const query = `\tif err := pool.QueryRow(ctx, \`SELECT ${quoteIdent(next)} FROM \`+models.${tableConst(hopEntity)}+\` WHERE ${quoteIdent(hop.targetColumn)} = $1\`, ${source}).Scan(&${v}); err != nil && !errors.Is(err, pgx.ErrNoRows) {\n\t\treturn false, err\n\t}`;
    lines.push(i === 0 ? query : `\tif ${source} != nil {\n${query.replace(/^\t/gm, "\t\t")}\n\t}`);
    source = v;
  });
  lines.push(`\treturn ${compareExpr(source, true, when)}, nil`);
  return lines.join("\n");
}

/** generated/scheduling/scheduling.go: schedules and timers, run as the system through River */
export function schedulingFile(ir: IR, modulePath: string): string {
  const imports = new Set<string>([
    "context",
    "errors",
    "time",
    "github.com/jackc/pgx/v5/pgxpool",
    `${modulePath}/generated/actions`,
    `${modulePath}/generated/actions/handlers`,
    `${modulePath}/generated/jobs`,
    `${modulePath}/generated/models`
  ]);
  const sections: string[] = [];
  sections.push(`var pool *pgxpool.Pool

// Use gives the package the database the handlers run against; app.New calls it.
func Use(p *pgxpool.Pool) {
	pool = p
}

func systemContext(ctx context.Context, now time.Time) *actions.Context {
	return &actions.Context{Ctx: ctx, Session: nil, DB: pool, Now: now}
}`);

  // Schedules
  sections.push(`// Schedule is a cron (UTC) and the action it runs as the system, with literal input.
type Schedule struct {
	Name  string
	Cron  string
	Run   string
	Input models.Values
}

// Schedules lists the model's schedules.
var Schedules = []Schedule{${ir.schedules.length ? "\n" : ""}${ir.schedules
    .map(s => {
      const run = s.run.resource ? `${s.run.resource}.${s.run.action}` : `actions.${s.run.action}`;
      const input = Object.entries(s.input)
        .map(([k, v]) => `${q(k)}: ${goLiteral(v)}`)
        .join(", ");
      return `\t{Name: ${q(s.name)}, Cron: ${q(s.cron)}, Run: ${q(run)}, Input: models.Values{${input}}},`;
    })
    .join("\n")}${ir.schedules.length ? "\n" : ""}}`);
  const scheduleCases = ir.schedules.map(s => {
    const action = actionOf(ir, s.run);
    const input = `actions.Parse${actionInputType(action)}(schedule.Input)`;
    const args =
      action.scope === "row" ? `systemContext(ctx, now), ${input}, nil` : `systemContext(ctx, now), ${input}`;
    return `\tcase ${q(s.name)}:\n\t\t${runStatement(action, args).replace(/\n\t/g, "\n\t\t")}`;
  });
  sections.push(`// RunSchedule runs a schedule's action now, as the system.
func RunSchedule(ctx context.Context, name string, now time.Time) error {
	var schedule *Schedule
	for i := range Schedules {
		if Schedules[i].Name == name {
			schedule = &Schedules[i]
		}
	}
	if schedule == nil {
		return errors.New("unknown schedule " + name)
	}
	switch name {
${scheduleCases.join("\n")}
	}
	return errors.New("unknown schedule " + name)
}

// RunSchedulesFor runs every schedule of an action (actions.send_digest, tasks.clear_done) now; the test hook.
func RunSchedulesFor(ctx context.Context, run string, now time.Time) (int, error) {
	ran := 0
	for _, schedule := range Schedules {
		if schedule.Run != run {
			continue
		}
		if err := RunSchedule(ctx, schedule.Name, now); err != nil {
			return ran, err
		}
		ran++
	}
	return ran, nil
}

// Periodic is what the worker runs on a cron.
func Periodic() []jobs.PeriodicSpec {
	specs := make([]jobs.PeriodicSpec, 0, len(Schedules))
	for _, schedule := range Schedules {
		name := schedule.Name
		specs = append(specs, jobs.PeriodicSpec{Name: name, Cron: schedule.Cron, Run: func(ctx context.Context, now time.Time) error {
			return RunSchedule(ctx, name, now)
		}})
	}
	return specs
}`);

  // Timers
  imports.add("encoding/json");
  if (ir.timers.length) imports.add("github.com/jackc/pgx/v5");
  const perEntity = new Map<string, TimerIR[]>();
  for (const t of ir.timers) perEntity.set(t.entity, [...(perEntity.get(t.entity) ?? []), t]);
  for (const [entityName, timers] of perEntity) {
    const entity = entityByName(ir, entityName);
    const T = typeName(entity);
    const pk = entity.columns.find(c => c.name === entity.primaryKey[0])!;
    const lines = timers.map(
      t => `	if due := due${exported(t.name)}(row); due != nil {
		if err := jobs.EnqueueTimer(ctx, ${q(t.name)}, row.${exported(pk.name)}, *due); err != nil {
			return err
		}
	}`
    );
    sections.push(`// Schedule${T} schedules the timers of a ${T} just written: one job per timer, due at the field plus its offset.
func Schedule${T}(ctx context.Context, row *models.${T}) error {
${lines.join("\n")}
	return nil
}

func load${T}(ctx context.Context, raw json.RawMessage) (*models.${T}, error) {
	var id ${rowGoType(pk)}
	if err := json.Unmarshal(raw, &id); err != nil {
		return nil, err
	}
	row, err := models.${scanFunc(entity)}(pool.QueryRow(ctx, \`SELECT \`+models.${columnsConst(entity)}+\` FROM \`+models.${tableConst(entity)}+\` WHERE ${quoteIdent(pk.name)} = $1\`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return row, err
}`);
  }
  for (const t of ir.timers) {
    const entity = entityByName(ir, t.entity);
    const T = typeName(entity);
    const col = entity.columns.find(c => c.name === t.column)!;
    const pointer = rowGoType(col).startsWith("*");
    const action = actionOf(ir, t.run);
    const N = exported(t.name);
    sections.push(`func due${N}(row *models.${T}) *time.Time {
${pointer ? `	if row.${exported(t.column)} == nil {\n\t\treturn nil\n\t}\n\tdue := row.${exported(t.column)}.Add(${t.afterSeconds} * time.Second)` : `	due := row.${exported(t.column)}.Add(${t.afterSeconds} * time.Second)`}
	return &due
}

func holds${N}(ctx context.Context, row *models.${T}) (bool, error) {
${holdsBody(ir, t, entity)}
}

func run${N}(ctx context.Context, row *models.${T}, now time.Time) error {
	${runStatement(action, `systemContext(ctx, now), actions.${actionInputType(action)}{}, row`)}
}

func dueRows${N}(ctx context.Context, now time.Time) ([]*models.${T}, error) {
	rows, err := pool.Query(ctx, \`SELECT \`+models.${columnsConst(entity)}+\` FROM \`+models.${tableConst(entity)}+\` WHERE ${quoteIdent(t.column)} IS NOT NULL AND ${quoteIdent(t.column)} <= $1\`, now.Add(-${t.afterSeconds}*time.Second))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]*models.${T}, 0)
	for rows.Next() {
		row, err := models.${scanFunc(entity)}(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}`);
  }
  const timerJobCases = ir.timers.map(t => {
    const T = typeName(entityByName(ir, t.entity));
    const N = exported(t.name);
    return `\tcase ${q(t.name)}:
		row, err := load${T}(ctx, id)
		if err != nil || row == nil {
			return err
		}
		at := due${N}(row)
		if at == nil || at.UTC().Format(time.RFC3339Nano) != due {
			return nil
		}
		if ok, err := holds${N}(ctx, row); err != nil || !ok {
			return err
		}
		return run${N}(ctx, row, time.Now().UTC())`;
  });
  const dueLoops = ir.timers.map(t => {
    const N = exported(t.name);
    return `	{
		rows, err := dueRows${N}(ctx, now)
		if err != nil {
			return ran, err
		}
		for _, row := range rows {
			ok, err := holds${N}(ctx, row)
			if err != nil {
				return ran, err
			}
			if !ok {
				continue
			}
			if err := run${N}(ctx, row, now); err != nil {
				return ran, err
			}
			ran++
		}
	}`;
  });
  sections.push(`// RunTimerJob runs a timer job the queue fired, if the row still says so: same due time, condition holds.
func RunTimerJob(ctx context.Context, name string, id json.RawMessage, due string) error {
	${ir.timers.length ? `switch name {\n${timerJobCases.join("\n")}\n\t}\n\treturn errors.New("unknown timer " + name)` : '_, _, _ = ctx, id, due\n\treturn errors.New("unknown timer " + name)'}
}

// RunDueTimers runs every timer due at now, as the worker would have by then: the test hook and a manual sweep.
func RunDueTimers(ctx context.Context, now time.Time) (int, error) {
	ran := 0
${ir.timers.length ? dueLoops.join("\n") : "\t_, _ = ctx, now"}
	return ran, nil
}`);
  return goFile(
    modulePath,
    HEADER("Schedules and timers: work the queue runs as the system. The worker and the test hooks call these."),
    "scheduling",
    imports,
    sections.join("\n\n")
  );
}

/** generated/testhooks/testhooks.go: a clock for timers and schedules, and the captured mailbox; mounted only with OSL_TEST_HOOKS=1 */
export function testHooksFile(ir: IR, modulePath: string, options: { email: boolean }): string {
  const scheduling = hasScheduling(ir);
  const imports = new Set<string>(["net/http", "time", "github.com/gin-gonic/gin"]);
  if (scheduling) imports.add(`${modulePath}/generated/scheduling`);
  if (options.email) imports.add(`${modulePath}/generated/email`);
  return goFile(
    modulePath,
    HEADER(
      "Test hooks: a clock for timers and schedules, and the captured mailbox. app.New mounts these only when OSL_TEST_HOOKS=1."
    ),
    "testhooks",
    imports,
    `type body struct {
	Now string \`json:"now"\`
	Run string \`json:"run"\`
}

// Routes mounts the hooks.
func Routes(r gin.IRouter) {
	r.POST("/api/osl-hooks/timers/run", timersRun)
	r.POST("/api/osl-hooks/schedules/run", schedulesRun)
	r.GET("/api/osl-hooks/emails", emails)
}

func readBody(c *gin.Context) body {
	var b body
	_ = c.ShouldBindJSON(&b)
	return b
}

// hookNow is the moment a hook runs at: the body's now, or the clock.
func hookNow(b body) time.Time {
	if t, err := time.Parse(time.RFC3339Nano, b.Now); err == nil {
		return t.UTC()
	}
	return time.Now().UTC()
}

func timersRun(c *gin.Context) {
	b := readBody(c)
	${
    scheduling
      ? `ran, err := scheduling.RunDueTimers(c.Request.Context(), hookNow(b))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "timer_failed", "message": err.Error()}})
		return
	}`
      : "_ = hookNow(b)\n\tran := 0"
  }
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ran": ran}})
}

func schedulesRun(c *gin.Context) {
	b := readBody(c)
	${
    scheduling
      ? `ran, err := scheduling.RunSchedulesFor(c.Request.Context(), b.Run, hookNow(b))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "schedule_failed", "message": err.Error()}})
		return
	}`
      : "_ = hookNow(b)\n\tran := 0"
  }
	if ran == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "unknown_schedule", "message": "no schedule runs " + b.Run}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ran": ran}})
}

func emails(c *gin.Context) {
	to, subject := c.Query("to"), c.Query("subject")
	out := make([]gin.H, 0)
	${
    options.email
      ? `for _, e := range email.Captured() {
		if (to != "" && e.To != to) || (subject != "" && !containsFold(e.Subject, subject)) {
			continue
		}
		out = append(out, gin.H{"to": e.To, "subject": e.Subject, "text": e.Text})
	}`
      : "_, _ = to, subject"
  }
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func containsFold(haystack, needle string) bool {
	return len(needle) == 0 || indexOf(haystack, needle) >= 0
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
`
  );
}
