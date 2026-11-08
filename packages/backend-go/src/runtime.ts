import type { IR } from "@osl/core";
import { HEADER, entityByName, goFile, q, rowGoType, singlePrimaryKey } from "./util.js";

/** generated/httpx/httpx.go: responses, body parsing and database error mapping. Static. */
export function httpxFile(modulePath: string): string {
  return goFile(
    modulePath,
    HEADER("HTTP helpers shared by every handler."),
    "httpx",
    [
      "encoding/json",
      "errors",
      "io",
      "log",
      "net/http",
      "github.com/gin-gonic/gin",
      "github.com/gin-gonic/gin/render",
      "github.com/jackc/pgx/v5",
      "github.com/jackc/pgx/v5/pgconn"
    ],
    `// Error is an HTTP error rendered as { "error": { "code", "message", "details" } }.
// Return one from a hook to reject the request with that status.
type Error struct {
	Status  int
	Code    string
	Message string
	Details any
}

func (e *Error) Error() string {
	return e.Code + ": " + e.Message
}

// NewError builds an Error without details.
func NewError(status int, code string, message string) *Error {
	return &Error{Status: status, Code: code, Message: message}
}

// NotFound is the response for a missing row or a malformed id.
func NotFound() *Error {
	return NewError(http.StatusNotFound, "not_found", "Not found")
}

// Validation is a 400 with the issues under details.
func Validation(message string, details any) *Error {
	return &Error{Status: http.StatusBadRequest, Code: "validation", Message: message, Details: details}
}

func invalidJSON() *Error {
	return NewError(http.StatusBadRequest, "invalid_json", "Request body must be valid JSON")
}

// Page describes one page of a list response.
type Page struct {
	Page     int \`json:"page"\`
	PageSize int \`json:"page_size"\`
	Total    int \`json:"total"\`
}

type envelope struct {
	Data any \`json:"data"\`
}

type pageEnvelope struct {
	Data any  \`json:"data"\`
	Page Page \`json:"page"\`
}

type errorBody struct {
	Code    string \`json:"code"\`
	Message string \`json:"message"\`
	Details any    \`json:"details,omitempty"\`
}

type errorEnvelope struct {
	Error errorBody \`json:"error"\`
}

func write(c *gin.Context, status int, body any) {
	c.Render(status, render.PureJSON{Data: body})
}

// OK writes 200 { "data": ... }.
func OK(c *gin.Context, data any) {
	write(c, http.StatusOK, envelope{Data: data})
}

// Created writes 201 { "data": ... }.
func Created(c *gin.Context, data any) {
	write(c, http.StatusCreated, envelope{Data: data})
}

// List writes 200 { "data": [...], "page": {...} }.
func List(c *gin.Context, data any, page Page) {
	write(c, http.StatusOK, pageEnvelope{Data: data, Page: page})
}

// NoContent writes 204 with no body.
func NoContent(c *gin.Context) {
	c.Status(http.StatusNoContent)
	c.Writer.WriteHeaderNow()
}

// Fail writes an Error.
func Fail(c *gin.Context, err *Error) {
	write(c, err.Status, errorEnvelope{Error: errorBody{Code: err.Code, Message: err.Message, Details: err.Details}})
}

// ParseBody reads a JSON object body. Invalid JSON is 400 invalid_json; a non-object is 400 validation.
func ParseBody(c *gin.Context) (map[string]json.RawMessage, *Error) {
	data, err := io.ReadAll(c.Request.Body)
	if err != nil {
		return nil, invalidJSON()
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(data, &body); err != nil {
		var typeErr *json.UnmarshalTypeError
		if errors.As(err, &typeErr) {
			return nil, Validation("Request body is invalid", []map[string]string{{"path": "", "message": "Expected object"}})
		}
		return nil, invalidJSON()
	}
	if body == nil {
		return nil, Validation("Request body is invalid", []map[string]string{{"path": "", "message": "Expected object"}})
	}
	return body, nil
}

// HandleError maps an error to a response: an Error as it is, a missing row to 404,
// database errors by SQLSTATE, anything else to 500. operation is read, write or delete.
func HandleError(c *gin.Context, err error, operation string) {
	var httpErr *Error
	if errors.As(err, &httpErr) {
		Fail(c, httpErr)
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		Fail(c, NotFound())
		return
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			Fail(c, NewError(http.StatusConflict, "conflict", "A row with the same unique value already exists"))
			return
		case "23503", "23001": // a missing referenced row, or ON DELETE RESTRICT refusing the delete
			if operation == "delete" || pgErr.Code == "23001" {
				Fail(c, NewError(http.StatusConflict, "conflict", "Other rows still reference this row"))
			} else {
				Fail(c, NewError(http.StatusBadRequest, "invalid_reference", "A referenced row does not exist"))
			}
			return
		case "23502":
			Fail(c, NewError(http.StatusBadRequest, "validation", "A required value is missing"))
			return
		case "22P02":
			if operation == "read" {
				Fail(c, NotFound())
			} else {
				Fail(c, NewError(http.StatusBadRequest, "validation", "A value has the wrong format"))
			}
			return
		}
	}
	log.Printf("internal error: %v", err)
	Fail(c, NewError(http.StatusInternalServerError, "internal", "Something went wrong"))
}
`
  );
}

/** generated/access/access.go: rule evaluation. Member rules rank roles by the tenancy's order. */
export function accessFile(ir: IR, modulePath: string): string {
  const tenancy = ir.auth?.tenancy;
  const tenantType = tenancy ? rowGoType(singlePrimaryKey(entityByName(ir, tenancy.entity))) : "string";
  const memberCheck = tenancy
    ? `
	case "member":
		if session == nil {
			return &Verdict{Status: http.StatusUnauthorized}
		}
		return nil`
    : "";
  const memberRow = tenancy
    ? `
	if rule.Kind == "member" && !memberOf(session, row[rule.Field], rule.Role) {
		return &Verdict{Status: http.StatusForbidden}
	}`
    : "";
  const memberSection = tenancy
    ? `

// roles lists the membership roles from most to least privileged.
var roles = []string{${tenancy.roles.map(q).join(", ")}}

func rank(role string) int {
	for i, candidate := range roles {
		if candidate == role {
			return i
		}
	}
	return len(roles)
}

// MemberTenantIDs lists the tenants the session's user belongs to, with at least role when it is not empty.
func MemberTenantIDs(session *auth.Session, role string) []${tenantType} {
	out := make([]${tenantType}, 0)
	if session == nil {
		return out
	}
	for _, m := range session.Memberships {
		if role == "" || rank(m.Role) <= rank(role) {
			out = append(out, m.Tenant)
		}
	}
	return out
}

// memberOf reports whether the session's user belongs to the tenant with at least role.
func memberOf(session *auth.Session, tenant any, role string) bool {
	for _, id := range MemberTenantIDs(session, role) {
		if same(id, tenant) {
			return true
		}
	}
	return false
}`
    : "";
  return goFile(
    modulePath,
    HEADER("Access rule evaluation."),
    "access",
    [
      "fmt",
      "net/http",
      "reflect",
      "github.com/gin-gonic/gin",
      `${modulePath}/generated/auth`,
      `${modulePath}/generated/httpx`
    ],
    `// Rule is an access rule from the model: public, authenticated, none, owner (Field), role (Value),
// member (Field names the row's tenant column, Role the least privileged role allowed, or "") or any
// (Any lists alternatives, one of which must allow). Field is a column, or the dotted path of a value
// reached through relations, which the handler resolves into the Row before checking.
type Rule struct {
	Kind  string
	Field string
	Value string
	Role  string
	Any   []Rule
}

// Row holds the values of a row (or a create body) that rules look at, by column or dotted path.
type Row map[string]any

// Verdict is a denial; nil means allowed.
type Verdict struct {
	Status int
}

// Check evaluates a rule before any row is loaded: 401 without a session, 403 for none and a wrong role.
func Check(rule Rule, session *auth.Session) *Verdict {
	switch rule.Kind {
	case "public":
		return nil
	case "none":
		return &Verdict{Status: http.StatusForbidden}
	case "authenticated", "owner":
		if session == nil {
			return &Verdict{Status: http.StatusUnauthorized}
		}
		return nil
	case "role":
		if session == nil {
			return &Verdict{Status: http.StatusUnauthorized}
		}
		if session.Role() != rule.Value {
			return &Verdict{Status: http.StatusForbidden}
		}
		return nil${memberCheck}
	case "any":
		return anyOf(rule.Any, func(alternative Rule) *Verdict { return Check(alternative, session) })
	}
	return &Verdict{Status: http.StatusForbidden}
}

// CheckRow evaluates a rule against a loaded row (or the body of a create): row holds the values the
// rule's fields name, the owner for owner rules and the tenant for member rules.
func CheckRow(rule Rule, session *auth.Session, row Row) *Verdict {
	if rule.Kind == "any" {
		return anyOf(rule.Any, func(alternative Rule) *Verdict { return CheckRow(alternative, session, row) })
	}
	if verdict := Check(rule, session); verdict != nil {
		return verdict
	}
	if rule.Kind == "owner" && !same(row[rule.Field], session.UserID()) {
		return &Verdict{Status: http.StatusForbidden}
	}${memberRow}
	return nil
}

// Satisfied reports whether the rule allows the session whatever the row, so a list under it needs no row filter.
func Satisfied(rule Rule, session *auth.Session) bool {
	switch rule.Kind {
	case "public":
		return true
	case "authenticated":
		return session != nil
	case "role":
		return session != nil && session.Role() == rule.Value
	case "any":
		for _, alternative := range rule.Any {
			if Satisfied(alternative, session) {
				return true
			}
		}
	}
	return false
}

// anyOf allows when any alternative does; otherwise it is 401 when every alternative was.
func anyOf(alternatives []Rule, check func(Rule) *Verdict) *Verdict {
	status := http.StatusUnauthorized
	for _, alternative := range alternatives {
		verdict := check(alternative)
		if verdict == nil {
			return nil
		}
		if verdict.Status != http.StatusUnauthorized {
			status = http.StatusForbidden
		}
	}
	return &Verdict{Status: status}
}

// Deny writes the response for a verdict.
func Deny(c *gin.Context, verdict *Verdict) {
	if verdict.Status == http.StatusUnauthorized {
		httpx.Fail(c, httpx.NewError(http.StatusUnauthorized, "unauthenticated", "Sign in to continue"))
		return
	}
	httpx.Fail(c, httpx.NewError(http.StatusForbidden, "forbidden", "You cannot do that"))
}

// same compares two ids after dereferencing pointers; a nil on either side never matches.
func same(a any, b any) bool {
	a, b = deref(a), deref(b)
	if a == nil || b == nil {
		return false
	}
	return fmt.Sprint(a) == fmt.Sprint(b)
}

func deref(value any) any {
	if value == nil {
		return nil
	}
	v := reflect.ValueOf(value)
	if v.Kind() == reflect.Pointer {
		if v.IsNil() {
			return nil
		}
		return v.Elem().Interface()
	}
	return value
}${memberSection}
`
  );
}

/** generated/db/db.go: the pool and small SQL builders. Static. */
export function dbFile(modulePath: string): string {
  return goFile(
    modulePath,
    HEADER("Database pool and SQL builders."),
    "db",
    ["context", "errors", "os", "sort", "strconv", "strings", "github.com/jackc/pgx/v5/pgxpool"],
    `// Connect opens a pool on DATABASE_URL and checks the connection.
func Connect(ctx context.Context) (*pgxpool.Pool, error) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		return nil, errors.New("DATABASE_URL is not set")
	}
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

// Quote double-quotes an identifier.
func Quote(ident string) string {
	return \`"\` + strings.ReplaceAll(ident, \`"\`, \`""\`) + \`"\`
}

// Where accumulates equality conditions and positional arguments.
type Where struct {
	conditions []string
	args       []any
}

// NewWhere starts an empty condition list.
func NewWhere() *Where {
	return &Where{}
}

// Eq adds column = value.
func (w *Where) Eq(column string, value any) {
	w.conditions = append(w.conditions, column+" = "+w.Param(value))
}

// In adds column = ANY(values); values is a typed slice pgx can encode as an array.
func (w *Where) In(column string, values any) {
	w.conditions = append(w.conditions, column+" = ANY("+w.Param(values)+")")
}

// Raw adds a condition the caller rendered, with placeholders from Param.
func (w *Where) Raw(condition string) {
	w.conditions = append(w.conditions, condition)
}

// AnyOf adds the conditions joined with OR as one condition.
func (w *Where) AnyOf(conditions []string) {
	w.conditions = append(w.conditions, "("+strings.Join(conditions, " OR ")+")")
}

// Search adds a case-insensitive substring match of text against any of the columns.
func (w *Where) Search(columns []string, text string) {
	pattern := w.Param("%" + EscapeLike(text) + "%")
	parts := make([]string, len(columns))
	for i, column := range columns {
		parts[i] = column + " ILIKE " + pattern
	}
	w.conditions = append(w.conditions, "("+strings.Join(parts, " OR ")+")")
}

// Param appends an argument and returns its placeholder.
func (w *Where) Param(value any) string {
	w.args = append(w.args, value)
	return "$" + strconv.Itoa(len(w.args))
}

// EscapeLike escapes the LIKE wildcards and the escape character itself so text matches literally.
func EscapeLike(text string) string {
	return likeEscaper.Replace(text)
}

var likeEscaper = strings.NewReplacer(\`\\\`, \`\\\\\`, "%", \`\\%\`, "_", \`\\_\`)

// SQL renders the WHERE clause, or "" without conditions.
func (w *Where) SQL() string {
	if len(w.conditions) == 0 {
		return ""
	}
	return " WHERE " + strings.Join(w.conditions, " AND ")
}

// Args returns the arguments in placeholder order.
func (w *Where) Args() []any {
	return w.args
}

// Insert renders INSERT ... RETURNING for the values, columns sorted by name.
func Insert(table string, values map[string]any, returning string) (string, []any) {
	columns := sortedKeys(values)
	if len(columns) == 0 {
		return "INSERT INTO " + table + " DEFAULT VALUES RETURNING " + returning, nil
	}
	quoted := make([]string, len(columns))
	placeholders := make([]string, len(columns))
	args := make([]any, len(columns))
	for i, column := range columns {
		quoted[i] = Quote(column)
		placeholders[i] = "$" + strconv.Itoa(i+1)
		args[i] = values[column]
	}
	return "INSERT INTO " + table + " (" + strings.Join(quoted, ", ") + ") VALUES (" + strings.Join(placeholders, ", ") + ") RETURNING " + returning, args
}

// Update renders UPDATE ... RETURNING for the patch, with the key as the last argument.
func Update(table string, values map[string]any, keyColumn string, key any, returning string) (string, []any) {
	columns := sortedKeys(values)
	sets := make([]string, len(columns))
	args := make([]any, 0, len(columns)+1)
	for i, column := range columns {
		args = append(args, values[column])
		sets[i] = Quote(column) + " = $" + strconv.Itoa(len(args))
	}
	args = append(args, key)
	return "UPDATE " + table + " SET " + strings.Join(sets, ", ") + " WHERE " + keyColumn + " = $" + strconv.Itoa(len(args)) + " RETURNING " + returning, args
}

func sortedKeys(values map[string]any) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
`
  );
}

/** generated/hooks/hooks.go: the context handed to user hooks. Static. */
export function hooksFile(modulePath: string): string {
  return goFile(
    modulePath,
    HEADER("Context passed to the hooks in src/extensions."),
    "hooks",
    ["github.com/gin-gonic/gin", `${modulePath}/generated/auth`],
    `// Context is what a hook sees: the request and the session, if any.
type Context struct {
	Gin     *gin.Context
	Session *auth.Session
}
`
  );
}
