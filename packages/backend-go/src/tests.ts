import type { IR, SeedStepIR, StepIR } from "@osl/core";
import { slugify, toPascalCase } from "@osl/core";
import { HEADER, goFile, keyedLiteral, q } from "./util.js";

/** generated/client/client.go: an HTTP client with a cookie jar, uploads, actors, matching and substitution. Static. */
export function clientFile(modulePath: string): string {
  return goFile(
    modulePath,
    HEADER("Client for the contract tests and the seed program."),
    "client",
    [
      "bytes",
      "encoding/json",
      "errors",
      "io",
      "net/http",
      "net/http/cookiejar",
      "net/url",
      "os",
      "regexp",
      "strconv",
      "strings",
      "time"
    ],
    `// BaseURL is where the app runs: OSL_BASE_URL, default http://localhost:8080.
func BaseURL() string {
	if v := os.Getenv("OSL_BASE_URL"); v != "" {
		return v
	}
	return "http://localhost:8080"
}

// Reply is a decoded response.
type Reply struct {
	Status int
	Body   any
}

// Client sends requests with a cookie jar, so a sign-in sticks.
type Client struct {
	HTTP *http.Client
}

// New builds a client with an empty cookie jar.
func New() *Client {
	jar, err := cookiejar.New(nil)
	if err != nil {
		panic(err)
	}
	return &Client{HTTP: &http.Client{Jar: jar, CheckRedirect: noRedirect}}
}

func noRedirect(*http.Request, []*http.Request) error {
	return http.ErrUseLastResponse
}

// Request sends one request, decodes the JSON reply and checks that no hidden column leaked.
func (c *Client) Request(method string, path string, query map[string]string, body any) (Reply, error) {
	target, err := url.Parse(BaseURL() + path)
	if err != nil {
		return Reply{}, err
	}
	if len(query) > 0 {
		values := target.Query()
		for key, value := range query {
			values.Set(key, value)
		}
		target.RawQuery = values.Encode()
	}
	var payload io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return Reply{}, err
		}
		payload = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, target.String(), payload)
	if err != nil {
		return Reply{}, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return Reply{}, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return Reply{}, err
	}
	var decoded any
	if len(data) > 0 {
		if err := json.Unmarshal(data, &decoded); err != nil {
			decoded = string(data)
		}
	}
	if err := assertNoHidden(decoded, path); err != nil {
		return Reply{}, err
	}
	return Reply{Status: res.StatusCode, Body: decoded}, nil
}

// Upload is the contract's files.upload: begin, PUT the bytes where told, complete. It answers the completed
// file, or the step that failed. input is { name, type, content }.
func (c *Client) Upload(input any) (Reply, error) {
	fields, _ := input.(map[string]any)
	name, _ := fields["name"].(string)
	contentType, _ := fields["type"].(string)
	content, _ := fields["content"].(string)
	data := []byte(content)
	begun, err := c.Request("POST", "/api/files", nil, map[string]any{"name": name, "type": contentType, "size": len(data)})
	if err != nil || begun.Status != http.StatusCreated {
		return begun, err
	}
	file := Pick(begun.Body, "data")
	base, err := url.Parse(BaseURL())
	if err != nil {
		return Reply{}, err
	}
	ref, err := url.Parse(Stringify(Pick(file, "upload.url")))
	if err != nil {
		return Reply{}, err
	}
	req, err := http.NewRequest(Stringify(Pick(file, "upload.method")), base.ResolveReference(ref).String(), bytes.NewReader(data))
	if err != nil {
		return Reply{}, err
	}
	if headers, ok := Pick(file, "upload.headers").(map[string]any); ok {
		for key, value := range headers {
			req.Header.Set(key, Stringify(value))
		}
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return Reply{}, err
	}
	defer res.Body.Close()
	text, err := io.ReadAll(res.Body)
	if err != nil {
		return Reply{}, err
	}
	if res.StatusCode >= 300 {
		return Reply{Status: res.StatusCode, Body: map[string]any{"error": map[string]any{"code": "upload_failed", "message": string(text)}}}, nil
	}
	return c.Request("POST", "/api/files/"+Stringify(Pick(file, "id"))+"/complete", nil, nil)
}

func assertNoHidden(value any, path string) error {
	switch v := value.(type) {
	case []any:
		for _, item := range v {
			if err := assertNoHidden(item, path); err != nil {
				return err
			}
		}
	case map[string]any:
		for key, inner := range v {
			if Hidden[key] {
				return errors.New("hidden column " + key + " leaked in the response of " + path)
			}
			if err := assertNoHidden(inner, path); err != nil {
				return err
			}
		}
	}
	return nil
}

// Actor is an example actor from the model: what register accepts, and the identity columns register refuses
// (its role), which Register writes straight into the database.
type Actor struct {
	Email       string
	Password    string
	Fields      map[string]any
	Provisioned map[string]any
}

// Session is a signed-in actor: its client and its user id.
type Session struct {
	Client *Client
	ID     any
}

// Register creates the actor's account; one that already exists is fine.
func Register(name string) error {
	definition, ok := Actors[name]
	if !ok {
		return errors.New("unknown actor " + name)
	}
	body := map[string]any{"email": definition.Email, "password": definition.Password}
	for key, value := range definition.Fields {
		body[key] = value
	}
	registered, err := New().Request("POST", "/api/auth/register", nil, body)
	if err != nil {
		return err
	}
	if registered.Status != http.StatusCreated && registered.Status != http.StatusConflict {
		return errors.New("could not register " + name + ": " + strconv.Itoa(registered.Status) + " " + Encode(registered.Body))
	}
	return provision(name, definition)
}

// RegisterAll creates every actor's account, so a scenario may sign one in explicitly before acting as it.
func RegisterAll() error {
	for name := range Actors {
		if err := Register(name); err != nil {
			return err
		}
	}
	return nil
}

// SignIn registers the actor if needed, then signs it in.
func SignIn(name string) (*Session, error) {
	definition, ok := Actors[name]
	if !ok {
		return nil, errors.New("unknown actor " + name)
	}
	if err := Register(name); err != nil {
		return nil, err
	}
	c := New()
	login, err := c.Request("POST", "/api/auth/login", nil, map[string]any{"email": definition.Email, "password": definition.Password})
	if err != nil {
		return nil, err
	}
	if login.Status != http.StatusOK {
		return nil, errors.New("could not sign in " + name + ": " + strconv.Itoa(login.Status) + " " + Encode(login.Body))
	}
	return &Session{Client: c, ID: Pick(login.Body, "data.id")}, nil
}

// Matches is a partial deep match: every expected key must match and every expected array element must match some actual element.
func Matches(expected any, actual any) bool {
	switch e := expected.(type) {
	case []any:
		a, ok := actual.([]any)
		if !ok {
			return false
		}
		for _, item := range e {
			found := false
			for _, candidate := range a {
				if Matches(item, candidate) {
					found = true
					break
				}
			}
			if !found {
				return false
			}
		}
		return true
	case map[string]any:
		a, ok := actual.(map[string]any)
		if !ok {
			return false
		}
		for key, value := range e {
			inner, present := a[key]
			if !present || !Matches(value, inner) {
				return false
			}
		}
		return true
	}
	return expected == actual
}

var wholePlaceholder = regexp.MustCompile(\`^\\{([a-zA-Z0-9_.+-]+)\\}$\`)

// nowPlaceholder is {now}, {now+2h} or {now-30d}: a timestamp relative to the clock.
var nowPlaceholder = regexp.MustCompile(\`^now(?:([+-])(\\d+)([mhd]))?$\`)

// lookup answers a placeholder: a relative time, or a captured value.
func lookup(vars map[string]any, name string) any {
	if m := nowPlaceholder.FindStringSubmatch(name); m != nil {
		offset := time.Duration(0)
		if m[2] != "" {
			n, _ := strconv.Atoi(m[2])
			unit := map[string]time.Duration{"m": time.Minute, "h": time.Hour, "d": 24 * time.Hour}[m[3]]
			offset = time.Duration(n) * unit
			if m[1] == "-" {
				offset = -offset
			}
		}
		return time.Now().UTC().Add(offset).Format(time.RFC3339Nano)
	}
	return Pick(vars, name)
}

var placeholder = regexp.MustCompile(\`\\{([a-zA-Z0-9_.+-]+)\\}\`)

// Resolve replaces "{name}" and "{name.path}" strings with captured values.
func Resolve(value any, vars map[string]any) any {
	switch v := value.(type) {
	case string:
		if m := wholePlaceholder.FindStringSubmatch(v); m != nil {
			return lookup(vars, m[1])
		}
		return placeholder.ReplaceAllStringFunc(v, func(match string) string {
			return Stringify(lookup(vars, strings.Trim(match, "{}")))
		})
	case []any:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = Resolve(item, vars)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(v))
		for key, inner := range v {
			out[key] = Resolve(inner, vars)
		}
		return out
	}
	return value
}

// Pick reads a dotted path out of decoded JSON.
func Pick(value any, path string) any {
	current := value
	for _, key := range strings.Split(path, ".") {
		switch v := current.(type) {
		case map[string]any:
			current = v[key]
		case []any:
			index, err := strconv.Atoi(key)
			if err != nil || index < 0 || index >= len(v) {
				return nil
			}
			current = v[index]
		default:
			return nil
		}
	}
	return current
}

// Stringify renders a value the way JavaScript's String() would.
func Stringify(value any) string {
	switch v := value.(type) {
	case nil:
		return "null"
	case string:
		return v
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(v)
	}
	return Encode(value)
}

// QueryOf turns a resolved query object into string parameters.
func QueryOf(value any) map[string]string {
	out := map[string]string{}
	if object, ok := value.(map[string]any); ok {
		for key, inner := range object {
			out[key] = Stringify(inner)
		}
	}
	return out
}

// WithActor is the scope of a step: the captured values plus the acting user's id as actor.id.
func WithActor(vars map[string]any, id any) map[string]any {
	scope := make(map[string]any, len(vars)+1)
	for key, value := range vars {
		scope[key] = value
	}
	scope["actor"] = map[string]any{"id": id}
	return scope
}

// Encode renders a value as JSON.
func Encode(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		return "<unencodable>"
	}
	return string(data)
}

// MustJSON decodes a JSON literal from the model.
func MustJSON(text string) any {
	var value any
	if err := json.Unmarshal([]byte(text), &value); err != nil {
		panic(err)
	}
	return value
}
`
  );
}

/** generated/client/model.go: the hidden columns, the example actors of the model, and how to provision them. */
export function clientModelFile(ir: IR, modulePath: string): string {
  const hidden = [...new Set(ir.entities.flatMap(e => e.columns.filter(c => c.hidden).map(c => c.name)))].sort();
  const jsonMap = (value: Record<string, unknown>) =>
    Object.keys(value).length ? `MustJSON(${q(JSON.stringify(value))}).(map[string]any)` : "nil";
  const actors = Object.entries(ir.examples.actors)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, a]): [string, string] => [
      q(name),
      `{Email: ${q(a.email)}, Password: ${q(a.password)}, Fields: ${jsonMap(a.fields)}, Provisioned: ${jsonMap(a.provisioned)}}`
    ]);
  const provisioning = ir.auth && Object.values(ir.examples.actors).some(a => Object.keys(a.provisioned).length > 0);
  const provision = provisioning
    ? `// provision writes the actor's identity columns that register refuses (its role) straight into the database
// (DATABASE_URL), so a scenario can act as an admin.
func provision(name string, definition Actor) error {
	if len(definition.Provisioned) == 0 {
		return nil
	}
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		return errors.New("actor " + name + " sets columns register refuses, which are written straight to the database: set DATABASE_URL")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	columns := make([]string, 0, len(definition.Provisioned))
	for column := range definition.Provisioned {
		columns = append(columns, column)
	}
	sort.Strings(columns)
	sets := make([]string, len(columns))
	args := make([]any, 0, len(columns)+1)
	for i, column := range columns {
		sets[i] = "\\"" + column + "\\" = $" + strconv.Itoa(i+1)
		args = append(args, definition.Provisioned[column])
	}
	args = append(args, definition.Email)
	_, err = conn.Exec(ctx, "update \\"${ir.auth!.identityTable}\\" set "+strings.Join(sets, ", ")+" where \\"${ir.auth!.emailColumn}\\" = $"+strconv.Itoa(len(args)), args...)
	return err
}`
    : `// provision has nothing to do: no actor sets a column register refuses.
func provision(string, Actor) error {
	return nil
}`;
  // A scenario that says a path must be absent (expect.absent) needs to tell a missing key from a null one
  const absent = ir.examples.scenarios.some(s => s.steps.some(step => step.expect.absent?.length));
  const carries = absent
    ? `

// Carries reports whether the dotted path is in a response body: every key on the way is there, whatever its
// value (a null is there). Through a list, it is there when any item carries the rest of the path.
func Carries(value any, path string) bool {
	return carries(value, strings.Split(path, "."))
}

func carries(value any, keys []string) bool {
	switch v := value.(type) {
	case []any:
		for _, item := range v {
			if carries(item, keys) {
				return true
			}
		}
		return false
	case map[string]any:
		inner, present := v[keys[0]]
		if !present {
			return false
		}
		return len(keys) == 1 || carries(inner, keys[1:])
	}
	return false
}`
    : "";
  return goFile(
    modulePath,
    HEADER("What the model says about responses and actors."),
    "client",
    provisioning
      ? ["context", "errors", "os", "sort", "strconv", "strings", "github.com/jackc/pgx/v5"]
      : absent
        ? ["strings"]
        : [],
    `// Hidden lists the columns that must never appear in any response.
var Hidden = ${keyedLiteral(
      "map[string]bool",
      hidden.map(h => [q(h), "true"])
    )}

// Actors are the model's example actors.
var Actors = ${keyedLiteral("map[string]Actor", actors)}

${provision}${carries}
`
  );
}

/** generated/tests/support_test.go: the client wrapped for testing.T. Static. */
export function testSupportFile(modulePath: string): string {
  return goFile(
    modulePath,
    HEADER("Contract test support: the client with failures reported through testing.T."),
    "tests",
    ["fmt", "os", "testing", `${modulePath}/generated/client`],
    `// TestMain registers every actor first, so a scenario may sign one in explicitly before acting as it.
func TestMain(m *testing.M) {
	if err := client.RegisterAll(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	os.Exit(m.Run())
}

func request(t *testing.T, c *client.Client, method string, path string, query map[string]string, body any) client.Reply {
	t.Helper()
	r, err := c.Request(method, path, query, body)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return r
}

func upload(t *testing.T, c *client.Client, input any) client.Reply {
	t.Helper()
	r, err := c.Upload(input)
	if err != nil {
		t.Fatalf("files.upload: %v", err)
	}
	return r
}

func actor(t *testing.T, name string) *client.Session {
	t.Helper()
	session, err := client.SignIn(name)
	if err != nil {
		t.Fatal(err)
	}
	return session
}

func expectStatus(t *testing.T, r client.Reply, status int) {
	t.Helper()
	if r.Status != status {
		t.Fatalf("expected status %d, got %d: %s", status, r.Status, client.Encode(r.Body))
	}
}

func expectBody(t *testing.T, r client.Reply, expected any) {
	t.Helper()
	if !client.Matches(expected, r.Body) {
		t.Fatalf("expected %s within %s", client.Encode(expected), client.Encode(r.Body))
	}
}
`
  );
}

function pathParts(step: SeedStepIR): string[] {
  return step.pathTemplate.split(/(\{[a-z_]+\})/).filter(Boolean);
}

function isUpload(step: SeedStepIR): boolean {
  return step.kind === "file" && step.operation === "upload";
}

/** Whether the step reads captured values (then `scope` is declared) */
function needsScope(step: SeedStepIR, expectBody: boolean): boolean {
  return (
    pathParts(step).some(p => p.startsWith("{")) ||
    Object.keys(step.query).length > 0 ||
    step.body !== undefined ||
    expectBody
  );
}

/** The Go expression of a step's path over `scope` */
function pathExpr(step: SeedStepIR): string {
  return pathParts(step)
    .map(part => {
      const m = part.match(/^\{([a-z_]+)\}$/);
      if (!m) return q(part);
      const raw = step.pathParams[m[1]];
      if (raw === undefined) throw new Error(`step ${step.op} needs path.${m[1]}`);
      return `url.PathEscape(client.Stringify(client.Resolve(${q(raw)}, scope)))`;
    })
    .join(" + ");
}

function bodyExpr(step: SeedStepIR): string {
  if (step.body !== undefined) return `client.Resolve(client.MustJSON(${q(JSON.stringify(step.body))}), scope)`;
  if (step.kind === "action" || isUpload(step)) return "map[string]any{}";
  return "nil";
}

function queryExpr(step: SeedStepIR): string {
  return Object.keys(step.query).length
    ? `client.QueryOf(client.Resolve(client.MustJSON(${q(JSON.stringify(step.query))}), scope))`
    : "nil";
}

/** One file per scenario, named so they run in order: generated/tests/01_<slug>_test.go */
export function scenarioTestFiles(ir: IR, modulePath: string): { path: string; content: string }[] {
  return ir.examples.scenarios.map((scenario, index) => {
    const number = String(index + 1).padStart(2, "0");
    const used = [...new Set(scenario.steps.map(s => s.as).filter((a): a is string => Boolean(a)))].sort();
    const name = `TestScenario${number}${toPascalCase(slugify(scenario.name))}`;
    const usesVars = scenario.steps.some(
      step => needsScope(step, step.expect.body !== undefined) || Object.keys(step.capture).length > 0
    );
    const imports = new Set<string>(["testing", `${modulePath}/generated/client`]);
    if (scenario.steps.some(step => pathParts(step).some(p => p.startsWith("{")))) imports.add("net/url");
    const steps = scenario.steps.map((step, i) => stepTest(step, i + 1)).join("\n");
    const setup = [
      ...(usesVars ? ["\tvars := map[string]any{}"] : []),
      ...used.map(a => `\t${a} := actor(t, ${q(a)})`)
    ];
    return {
      path: `generated/tests/${number}_${slugify(scenario.name).replace(/-/g, "_")}_test.go`,
      content: goFile(
        modulePath,
        HEADER(`Contract test for the scenario "${scenario.name}".`),
        "tests",
        imports,
        `// ${name} is the scenario "${scenario.name}".
func ${name}(t *testing.T) {
${setup.join("\n")}${setup.length ? "\n" : ""}${steps}
}
`
      )
    };
  });
}

function stepTest(step: StepIR, number: number): string {
  const title = step.name ?? `${number}. ${step.as ? step.as + " " : ""}${step.op}`;
  const lines: string[] = [];
  lines.push(`\tt.Run(${q(title)}, func(t *testing.T) {`);
  lines.push(`\t\tc := ${step.as ? `${step.as}.Client` : "client.New()"}`);
  if (needsScope(step, step.expect.body !== undefined))
    lines.push(`\t\tscope := client.WithActor(vars, ${step.as ? `${step.as}.ID` : "nil"})`);
  if (isUpload(step)) lines.push(`\t\tr := upload(t, c, ${bodyExpr(step)})`);
  else {
    lines.push(`\t\tpath := ${pathExpr(step)}`);
    lines.push(`\t\tr := request(t, c, ${q(step.method)}, path, ${queryExpr(step)}, ${bodyExpr(step)})`);
  }
  lines.push(`\t\texpectStatus(t, r, ${step.expect.status})`);
  if (step.expect.body !== undefined)
    lines.push(`\t\texpectBody(t, r, client.Resolve(client.MustJSON(${q(JSON.stringify(step.expect.body))}), scope))`);
  if (step.expect.absent?.length)
    lines.push(
      `\t\tfor _, path := range []string{${step.expect.absent.map(q).join(", ")}} {\n\t\t\tif client.Carries(r.Body, path) {\n\t\t\t\tt.Fatalf("%s must be absent from %s", path, client.Encode(r.Body))\n\t\t\t}\n\t\t}`
    );
  for (const [name, path] of Object.entries(step.capture))
    lines.push(`\t\tvars[${q(name)}] = client.Pick(r.Body, ${q(path)})`);
  lines.push(`\t})`);
  return lines.join("\n");
}

/** cmd/seed/main.go: replays examples.seed against a running app (OSL_BASE_URL); rows that already exist (409) are skipped. */
export function seedFile(ir: IR, modulePath: string): string {
  const steps = ir.examples.seed;
  const imports = new Set<string>(["fmt", "os", `${modulePath}/generated/client`]);
  if (steps.length === 0) {
    return goFile(
      modulePath,
      HEADER("Seed: the model declares no seed steps."),
      "main",
      ["fmt"],
      `func main() {
	fmt.Println("nothing to seed: the model declares no seed steps")
}
`
    );
  }
  if (steps.some(step => pathParts(step).some(p => p.startsWith("{")))) imports.add("net/url");
  const usesActors = steps.some(step => step.as);
  const usesAnonymous = steps.some(step => !step.as);
  const blocks = steps.map((step, i) => {
    const lines: string[] = ["\t{"];
    lines.push(`\t\tc := ${step.as ? `session(${q(step.as)}).Client` : "anonymous"}`);
    if (needsScope(step, false))
      lines.push(`\t\tscope := client.WithActor(vars, ${step.as ? `session(${q(step.as)}).ID` : "nil"})`);
    if (isUpload(step)) lines.push(`\t\tr, err := c.Upload(${bodyExpr(step)})`);
    else {
      lines.push(`\t\tpath := ${pathExpr(step)}`);
      lines.push(`\t\tr, err := c.Request(${q(step.method)}, path, ${queryExpr(step)}, ${bodyExpr(step)})`);
    }
    lines.push(`\t\treport(${i + 1}, ${q(step.name ?? step.op)}, r, err)`);
    for (const [name, path] of Object.entries(step.capture))
      lines.push(`\t\tvars[${q(name)}] = client.Pick(r.Body, ${q(path)})`);
    lines.push("\t}");
    return lines.join("\n");
  });
  const usesVars = steps.some(step => needsScope(step, false) || Object.keys(step.capture).length > 0);
  const setup: string[] = [...(usesVars ? ["\tvars := map[string]any{}"] : []), "\tfailed := false"];
  if (usesAnonymous) setup.push("\tanonymous := client.New()");
  if (usesActors)
    setup.push(`\tsessions := map[string]*client.Session{}
	session := func(name string) *client.Session {
		if s := sessions[name]; s != nil {
			return s
		}
		s, err := client.SignIn(name)
		if err != nil {
			fmt.Println("fail: " + err.Error())
			os.Exit(1)
		}
		sessions[name] = s
		return s
	}`);
  setup.push(`\treport := func(step int, name string, r client.Reply, err error) {
		switch {
		case err != nil:
			fmt.Printf("fail %d %s: %v\\n", step, name, err)
			failed = true
		case r.Status == 409:
			fmt.Printf("skip %d %s (already there)\\n", step, name)
		case r.Status >= 400:
			fmt.Printf("fail %d %s: %d %s\\n", step, name, r.Status, client.Encode(r.Body))
			failed = true
		default:
			fmt.Printf("ok   %d %s\\n", step, name)
		}
	}`);
  return goFile(
    modulePath,
    HEADER(
      "Seed: replays examples.seed against a running app (OSL_BASE_URL). Rows that already exist (409) are skipped."
    ),
    "main",
    imports,
    `func main() {
${setup.join("\n")}
${blocks.join("\n")}
	if failed {
		os.Exit(1)
	}
}
`
  );
}
