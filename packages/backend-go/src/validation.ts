import type { ActionIR, ColumnIR, EntityIR, IR, OperationIR, ResourceIR } from "@osl/core";
import { HEADER, cap, column, entityByName, exported, goFile, q, singlePrimaryKey } from "./util.js";

/** generated/validation/types.go: the validation runtime. Static. */
export function validationRuntimeFile(modulePath: string): string {
  return goFile(
    modulePath,
    HEADER("Validation runtime: JSON bodies and query strings become typed values."),
    "validation",
    [
      "bytes",
      "encoding/json",
      "math",
      "net/url",
      "regexp",
      "sort",
      "strconv",
      "strings",
      "time",
      "unicode/utf8",
      `${modulePath}/generated/httpx`,
      `${modulePath}/generated/models`
    ],
    `// Issue is one validation problem, reported under error.details.
type Issue struct {
	Path    string \`json:"path"\`
	Message string \`json:"message"\`
}

// Type parses one JSON value, or one query string value, into a Go value pgx can encode.
type Type interface {
	Parse(path string, raw json.RawMessage) (any, []Issue)
	ParseString(path string, value string) (any, []Issue)
	Slice(items []any) any
}

// Field is one key of a JSON object body.
type Field struct {
	Name     string
	Required bool
	Nullable bool
	Type     Type
}

// Object validates a JSON object body and rejects unknown keys.
type Object struct {
	Fields []Field
}

// Parse checks body against the fields and returns the accepted values.
func (o Object) Parse(body map[string]json.RawMessage) (models.Values, *httpx.Error) {
	var issues []Issue
	values := models.Values{}
	known := map[string]bool{}
	for _, field := range o.Fields {
		known[field.Name] = true
		raw, present := body[field.Name]
		if !present {
			if field.Required {
				issues = append(issues, Issue{Path: field.Name, Message: "Required"})
			}
			continue
		}
		if isNull(raw) {
			if field.Nullable {
				values[field.Name] = nil
			} else {
				issues = append(issues, Issue{Path: field.Name, Message: "Expected a value, received null"})
			}
			continue
		}
		value, problems := field.Type.Parse(field.Name, raw)
		if len(problems) > 0 {
			issues = append(issues, problems...)
			continue
		}
		values[field.Name] = value
	}
	issues = append(issues, unknownKeys(known, bodyKeys(body))...)
	if len(issues) > 0 {
		return nil, httpx.Validation("Request body is invalid", issues)
	}
	return values, nil
}

// Filter is one equality filter of a list operation.
type Filter struct {
	Name string
	Type Type
}

// Query validates the query string of a list operation. Sortable lists the fields \`sort=<field>:asc|desc\`
// accepts; Search allows \`q\`.
type Query struct {
	PageSize int
	Filters  []Filter
	Sortable []string
	Search   bool
}

// ListParams is a validated list query. Sort is "<field>:<asc|desc>" or empty; Q is the search text or empty.
type ListParams struct {
	Page     int
	PageSize int
	Filters  map[string]any
	Sort     string
	Q        string
}

// Offset is the number of rows to skip for the page.
func (p *ListParams) Offset() int {
	return (p.Page - 1) * p.PageSize
}

// Parse checks the query string and rejects unknown keys.
func (q Query) Parse(values url.Values) (*ListParams, *httpx.Error) {
	var issues []Issue
	params := &ListParams{Page: 1, PageSize: q.PageSize, Filters: map[string]any{}}
	known := map[string]bool{"page": true, "page_size": true}
	if raw, ok := last(values, "page"); ok {
		n, good := parseIntString(raw)
		if !good || n < 1 {
			issues = append(issues, Issue{Path: "page", Message: "Expected an integer of at least 1"})
		} else {
			params.Page = n
		}
	}
	if raw, ok := last(values, "page_size"); ok {
		n, good := parseIntString(raw)
		if !good || n < 1 || n > 200 {
			issues = append(issues, Issue{Path: "page_size", Message: "Expected an integer between 1 and 200"})
		} else {
			params.PageSize = n
		}
	}
	for _, filter := range q.Filters {
		known[filter.Name] = true
		raw, ok := last(values, filter.Name)
		if !ok {
			continue
		}
		value, problems := filter.Type.ParseString(filter.Name, raw)
		if len(problems) > 0 {
			issues = append(issues, problems...)
			continue
		}
		params.Filters[filter.Name] = value
	}
	if len(q.Sortable) > 0 {
		known["sort"] = true
		if raw, ok := last(values, "sort"); ok {
			if sortOptions(q.Sortable)[raw] {
				params.Sort = raw
			} else {
				issues = append(issues, Issue{Path: "sort", Message: "Invalid enum value. Expected one of " + strings.Join(sortOptionList(q.Sortable), ", ")})
			}
		}
	}
	if q.Search {
		known["q"] = true
		if raw, ok := last(values, "q"); ok {
			if utf8.RuneCountInString(raw) > 200 {
				issues = append(issues, Issue{Path: "q", Message: "String must contain at most 200 character(s)"})
			} else {
				params.Q = raw
			}
		}
	}
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	issues = append(issues, unknownKeys(known, keys)...)
	if len(issues) > 0 {
		return nil, httpx.Validation("Query string is invalid", issues)
	}
	return params, nil
}

// SortColumn splits a validated sort value into its column and direction (ASC or DESC).
func SortColumn(sort string) (string, string) {
	field, direction, _ := strings.Cut(sort, ":")
	if direction == "desc" {
		return field, "DESC"
	}
	return field, "ASC"
}

func sortOptionList(sortable []string) []string {
	out := make([]string, 0, len(sortable)*2)
	for _, field := range sortable {
		out = append(out, field+":asc", field+":desc")
	}
	return out
}

func sortOptions(sortable []string) map[string]bool {
	out := map[string]bool{}
	for _, option := range sortOptionList(sortable) {
		out[option] = true
	}
	return out
}

// String validates a JSON string. Zero limits mean no limit.
type String struct {
	MinLength int
	MaxLength int
	Format    string
	Pattern   *regexp.Regexp
}

func (t String) Parse(path string, raw json.RawMessage) (any, []Issue) {
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, []Issue{{Path: path, Message: "Expected string"}}
	}
	var issues []Issue
	length := utf8.RuneCountInString(s)
	if t.MinLength > 0 && length < t.MinLength {
		issues = append(issues, Issue{Path: path, Message: "String must contain at least " + strconv.Itoa(t.MinLength) + " character(s)"})
	}
	if t.MaxLength > 0 && length > t.MaxLength {
		issues = append(issues, Issue{Path: path, Message: "String must contain at most " + strconv.Itoa(t.MaxLength) + " character(s)"})
	}
	switch t.Format {
	case "email":
		if !isEmail(s) {
			issues = append(issues, Issue{Path: path, Message: "Invalid email"})
		}
	case "url":
		if !isURL(s) {
			issues = append(issues, Issue{Path: path, Message: "Invalid url"})
		}
	case "uuid":
		if !uuidPattern.MatchString(s) {
			issues = append(issues, Issue{Path: path, Message: "Invalid uuid"})
		}
	}
	if t.Pattern != nil && !t.Pattern.MatchString(s) {
		issues = append(issues, Issue{Path: path, Message: "Invalid"})
	}
	if len(issues) > 0 {
		return nil, issues
	}
	return s, nil
}

func (t String) ParseString(path string, value string) (any, []Issue) {
	return value, nil
}

func (t String) Slice(items []any) any {
	return collect[string](items)
}

// Integer validates a JSON integer.
type Integer struct {
	Min *float64
	Max *float64
}

func (t Integer) Parse(path string, raw json.RawMessage) (any, []Issue) {
	f, ok := number(raw)
	if !ok || f != math.Trunc(f) {
		return nil, []Issue{{Path: path, Message: "Expected integer"}}
	}
	if issues := bounds(path, f, t.Min, t.Max); issues != nil {
		return nil, issues
	}
	return int(f), nil
}

func (t Integer) ParseString(path string, value string) (any, []Issue) {
	n, ok := parseIntString(value)
	if !ok {
		return nil, []Issue{{Path: path, Message: "Expected integer"}}
	}
	return n, nil
}

func (t Integer) Slice(items []any) any {
	return collect[int](items)
}

// BigInt validates a JSON integer into an int64.
type BigInt struct {
	Min *float64
	Max *float64
}

func (t BigInt) Parse(path string, raw json.RawMessage) (any, []Issue) {
	f, ok := number(raw)
	if !ok || f != math.Trunc(f) {
		return nil, []Issue{{Path: path, Message: "Expected integer"}}
	}
	if issues := bounds(path, f, t.Min, t.Max); issues != nil {
		return nil, issues
	}
	return int64(f), nil
}

func (t BigInt) ParseString(path string, value string) (any, []Issue) {
	n, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil {
		return nil, []Issue{{Path: path, Message: "Expected integer"}}
	}
	return n, nil
}

func (t BigInt) Slice(items []any) any {
	return collect[int64](items)
}

// Float validates a JSON number.
type Float struct {
	Min *float64
	Max *float64
}

func (t Float) Parse(path string, raw json.RawMessage) (any, []Issue) {
	f, ok := number(raw)
	if !ok {
		return nil, []Issue{{Path: path, Message: "Expected number"}}
	}
	if issues := bounds(path, f, t.Min, t.Max); issues != nil {
		return nil, issues
	}
	return f, nil
}

func (t Float) ParseString(path string, value string) (any, []Issue) {
	return parseFloatString(path, value)
}

func (t Float) Slice(items []any) any {
	return collect[float64](items)
}

// Decimal accepts a JSON number or a numeric string and keeps it as text.
type Decimal struct {
	Min *float64
	Max *float64
}

func (t Decimal) Parse(path string, raw json.RawMessage) (any, []Issue) {
	if f, ok := number(raw); ok {
		if issues := bounds(path, f, t.Min, t.Max); issues != nil {
			return nil, issues
		}
		return strconv.FormatFloat(f, 'f', -1, 64), nil
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil || !decimalPattern.MatchString(s) {
		return nil, []Issue{{Path: path, Message: "Expected a number or a numeric string"}}
	}
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		if issues := bounds(path, f, t.Min, t.Max); issues != nil {
			return nil, issues
		}
	}
	return s, nil
}

func (t Decimal) ParseString(path string, value string) (any, []Issue) {
	return parseFloatString(path, value)
}

func (t Decimal) Slice(items []any) any {
	return collect[string](items)
}

// Boolean validates a JSON boolean; in a query string, "true" or "false".
type Boolean struct{}

func (t Boolean) Parse(path string, raw json.RawMessage) (any, []Issue) {
	var b bool
	if err := json.Unmarshal(raw, &b); err != nil {
		return nil, []Issue{{Path: path, Message: "Expected boolean"}}
	}
	return b, nil
}

func (t Boolean) ParseString(path string, value string) (any, []Issue) {
	switch value {
	case "true":
		return true, nil
	case "false":
		return false, nil
	}
	return nil, []Issue{{Path: path, Message: "Expected true or false"}}
}

func (t Boolean) Slice(items []any) any {
	return collect[bool](items)
}

// DateTime validates an RFC 3339 timestamp.
type DateTime struct{}

func (t DateTime) Parse(path string, raw json.RawMessage) (any, []Issue) {
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, []Issue{{Path: path, Message: "Expected string"}}
	}
	parsed, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return nil, []Issue{{Path: path, Message: "Invalid datetime"}}
	}
	return parsed, nil
}

func (t DateTime) ParseString(path string, value string) (any, []Issue) {
	return value, nil
}

func (t DateTime) Slice(items []any) any {
	return collect[time.Time](items)
}

// Date validates a YYYY-MM-DD string.
type Date struct{}

func (t Date) Parse(path string, raw json.RawMessage) (any, []Issue) {
	return pattern(path, raw, datePattern, "Invalid date")
}

func (t Date) ParseString(path string, value string) (any, []Issue) {
	return value, nil
}

func (t Date) Slice(items []any) any {
	return collect[string](items)
}

// Time validates an HH:MM or HH:MM:SS string.
type Time struct{}

func (t Time) Parse(path string, raw json.RawMessage) (any, []Issue) {
	return pattern(path, raw, timePattern, "Invalid time")
}

func (t Time) ParseString(path string, value string) (any, []Issue) {
	return value, nil
}

func (t Time) Slice(items []any) any {
	return collect[string](items)
}

// UUID validates a UUID string.
type UUID struct{}

func (t UUID) Parse(path string, raw json.RawMessage) (any, []Issue) {
	return pattern(path, raw, uuidPattern, "Invalid uuid")
}

func (t UUID) ParseString(path string, value string) (any, []Issue) {
	if !uuidPattern.MatchString(value) {
		return nil, []Issue{{Path: path, Message: "Invalid uuid"}}
	}
	return value, nil
}

func (t UUID) Slice(items []any) any {
	return collect[string](items)
}

// JSON accepts any JSON value.
type JSON struct{}

func (t JSON) Parse(path string, raw json.RawMessage) (any, []Issue) {
	return json.RawMessage(append([]byte(nil), raw...)), nil
}

func (t JSON) ParseString(path string, value string) (any, []Issue) {
	return value, nil
}

func (t JSON) Slice(items []any) any {
	return collect[json.RawMessage](items)
}

// Enum validates one of a fixed set of strings.
type Enum struct {
	Values []string
}

func (t Enum) Parse(path string, raw json.RawMessage) (any, []Issue) {
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, []Issue{{Path: path, Message: "Expected string"}}
	}
	return t.ParseString(path, s)
}

func (t Enum) ParseString(path string, value string) (any, []Issue) {
	for _, candidate := range t.Values {
		if candidate == value {
			return value, nil
		}
	}
	return nil, []Issue{{Path: path, Message: "Invalid enum value. Expected one of " + strings.Join(t.Values, ", ")}}
}

func (t Enum) Slice(items []any) any {
	return collect[string](items)
}

// Array validates a JSON array of Of.
type Array struct {
	Of Type
}

func (t Array) Parse(path string, raw json.RawMessage) (any, []Issue) {
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil || isNull(raw) {
		return nil, []Issue{{Path: path, Message: "Expected array"}}
	}
	var issues []Issue
	parsed := make([]any, 0, len(items))
	for i, item := range items {
		itemPath := path + "." + strconv.Itoa(i)
		if isNull(item) {
			issues = append(issues, Issue{Path: itemPath, Message: "Expected a value, received null"})
			continue
		}
		value, problems := t.Of.Parse(itemPath, item)
		if len(problems) > 0 {
			issues = append(issues, problems...)
			continue
		}
		parsed = append(parsed, value)
	}
	if len(issues) > 0 {
		return nil, issues
	}
	return t.Of.Slice(parsed), nil
}

func (t Array) ParseString(path string, value string) (any, []Issue) {
	return value, nil
}

func (t Array) Slice(items []any) any {
	return items
}

// F is a bound for Integer, BigInt and Float.
func F(value float64) *float64 {
	return &value
}

// Regexp compiles a pattern from the model.
func Regexp(pattern string) *regexp.Regexp {
	return regexp.MustCompile(pattern)
}

// ParseUUIDID accepts a UUID path parameter.
func ParseUUIDID(raw string) (string, bool) {
	return raw, uuidPattern.MatchString(raw)
}

// ParseIntID accepts an integer path parameter.
func ParseIntID(raw string) (int, bool) {
	return parseIntString(raw)
}

// ParseInt64ID accepts a bigint path parameter.
func ParseInt64ID(raw string) (int64, bool) {
	n, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	return n, err == nil
}

// ParseStringID accepts any non-empty path parameter.
func ParseStringID(raw string) (string, bool) {
	return raw, raw != ""
}

var uuidPattern = regexp.MustCompile(\`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$\`)

var datePattern = regexp.MustCompile(\`^\\d{4}-\\d{2}-\\d{2}$\`)

var timePattern = regexp.MustCompile(\`^\\d{2}:\\d{2}(:\\d{2})?$\`)

var decimalPattern = regexp.MustCompile(\`^-?\\d+(\\.\\d+)?$\`)

func collect[T any](items []any) []T {
	out := make([]T, len(items))
	for i, item := range items {
		out[i] = item.(T)
	}
	return out
}

func isNull(raw json.RawMessage) bool {
	return bytes.Equal(bytes.TrimSpace(raw), []byte("null"))
}

func number(raw json.RawMessage) (float64, bool) {
	var f float64
	if err := json.Unmarshal(raw, &f); err != nil {
		return 0, false
	}
	return f, true
}

func bounds(path string, f float64, lo *float64, hi *float64) []Issue {
	var issues []Issue
	if lo != nil && f < *lo {
		issues = append(issues, Issue{Path: path, Message: "Number must be at least " + strconv.FormatFloat(*lo, 'f', -1, 64)})
	}
	if hi != nil && f > *hi {
		issues = append(issues, Issue{Path: path, Message: "Number must be at most " + strconv.FormatFloat(*hi, 'f', -1, 64)})
	}
	return issues
}

func pattern(path string, raw json.RawMessage, re *regexp.Regexp, message string) (any, []Issue) {
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, []Issue{{Path: path, Message: "Expected string"}}
	}
	if !re.MatchString(s) {
		return nil, []Issue{{Path: path, Message: message}}
	}
	return s, nil
}

func parseIntString(value string) (int, bool) {
	f, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || math.IsInf(f, 0) || f != math.Trunc(f) {
		return 0, false
	}
	return int(f), true
}

func parseFloatString(path string, value string) (any, []Issue) {
	f, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || math.IsInf(f, 0) || math.IsNaN(f) {
		return nil, []Issue{{Path: path, Message: "Expected number"}}
	}
	return f, nil
}

func last(values url.Values, key string) (string, bool) {
	list, ok := values[key]
	if !ok || len(list) == 0 {
		return "", false
	}
	return list[len(list)-1], true
}

func bodyKeys(body map[string]json.RawMessage) []string {
	keys := make([]string, 0, len(body))
	for key := range body {
		keys = append(keys, key)
	}
	return keys
}

func unknownKeys(known map[string]bool, keys []string) []Issue {
	unknown := make([]string, 0)
	for _, key := range keys {
		if !known[key] {
			unknown = append(unknown, key)
		}
	}
	sort.Strings(unknown)
	issues := make([]Issue, 0, len(unknown))
	for _, key := range unknown {
		issues = append(issues, Issue{Path: key, Message: "Unrecognized key"})
	}
	return issues
}

func isAlnum(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')
}

func isAlpha(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
}

// isEmail mirrors the reference backend's email rule: a local part of letters, digits and _'+-.
// that neither starts with a dot nor holds two in a row, then a domain of labels and a letter-only TLD.
func isEmail(s string) bool {
	at := strings.LastIndex(s, "@")
	if at <= 0 || at == len(s)-1 {
		return false
	}
	localPart, domain := s[:at], s[at+1:]
	if strings.HasPrefix(localPart, ".") || strings.HasSuffix(localPart, ".") || strings.Contains(localPart, "..") {
		return false
	}
	for _, r := range localPart {
		if !isAlnum(r) && !strings.ContainsRune("_'+-.", r) {
			return false
		}
	}
	labels := strings.Split(domain, ".")
	if len(labels) < 2 {
		return false
	}
	for _, label := range labels {
		if label == "" || !isAlnum(rune(label[0])) {
			return false
		}
		for _, r := range label {
			if !isAlnum(r) && r != '-' {
				return false
			}
		}
	}
	tld := labels[len(labels)-1]
	if len(tld) < 2 {
		return false
	}
	for _, r := range tld {
		if !isAlpha(r) {
			return false
		}
	}
	return true
}

func isURL(s string) bool {
	u, err := url.Parse(s)
	if err != nil || u.Scheme == "" {
		return false
	}
	if (u.Scheme == "http" || u.Scheme == "https") && u.Host == "" {
		return false
	}
	return true
}
`
  );
}

/** Go expression for a validation.Type that checks a column's value */
/** `p` is the package qualifier: "validation." from other packages, "" inside it. */
export function typeExpr(ir: IR, col: ColumnIR, mode: "body" | "filter", p = "validation."): string {
  const t = col.type;
  if (t.kind === "enum") {
    const values = col.enumValues ?? ir.enums.find(e => e.name === t.name)?.values ?? [];
    return `${p}Enum{Values: []string{${values.map(q).join(", ")}}}`;
  }
  if (t.kind === "array") return `${p}Array{Of: ${scalarTypeExpr(t.of, col, mode, p)}}`;
  // A file field takes the id of an upload; the handler swaps it for the file's snapshot
  if (t.kind === "file") return `${p}UUID{}`;
  return scalarTypeExpr(t.scalar, col, mode, p);
}

function scalarTypeExpr(scalar: string, col: ColumnIR, mode: "body" | "filter", p: string): string {
  const v = mode === "body" ? (col.validate ?? {}) : {};
  const bounds = (): string => {
    const parts: string[] = [];
    if (v.min !== undefined) parts.push(`Min: ${p}F(${v.min})`);
    if (v.max !== undefined) parts.push(`Max: ${p}F(${v.max})`);
    return parts.join(", ");
  };
  switch (scalar) {
    case "string":
    case "text": {
      const parts: string[] = [];
      if (v.min_length !== undefined && v.min_length > 0) parts.push(`MinLength: ${v.min_length}`);
      const max =
        mode === "body" ? (v.max_length ?? (scalar === "string" ? (col.maxLength ?? 255) : undefined)) : undefined;
      if (max !== undefined) parts.push(`MaxLength: ${max}`);
      if (v.format) parts.push(`Format: ${q(v.format)}`);
      if (v.pattern) parts.push(`Pattern: ${p}Regexp(${q(v.pattern)})`);
      return `${p}String{${parts.join(", ")}}`;
    }
    case "integer":
      return `${p}Integer{${bounds()}}`;
    case "bigint":
      return `${p}BigInt{${bounds()}}`;
    case "float":
      return `${p}Float{${bounds()}}`;
    case "decimal":
      return `${p}Decimal{${bounds()}}`;
    case "boolean":
      return `${p}Boolean{}`;
    case "datetime":
      return `${p}DateTime{}`;
    case "date":
      return `${p}Date{}`;
    case "time":
      return `${p}Time{}`;
    case "uuid":
      return `${p}UUID{}`;
    case "json":
      return `${p}JSON{}`;
    default:
      throw new Error(`no validation type for ${scalar}`);
  }
}

/** One validation.Field literal for a column in create or update mode */
export function fieldLiteral(ir: IR, col: ColumnIR, mode: "create" | "update", p = "validation."): string {
  const parts = [`Name: ${q(col.name)}`];
  const required = mode === "create" && !col.nullable && col.default === undefined && !col.generated;
  if (required) parts.push("Required: true");
  if (col.nullable) parts.push("Nullable: true");
  parts.push(`Type: ${typeExpr(ir, col, "body", p)}`);
  return `{${parts.join(", ")}}`;
}

export function objectLiteral(fields: string[], p = "validation."): string {
  if (fields.length === 0) return `${p}Object{}`;
  return `${p}Object{Fields: []${p}Field{\n${fields.map(f => `\t${f},`).join("\n")}\n}}`;
}

export function idParser(entity: EntityIR, p = "validation."): { call: string; goType: string } {
  const pk = singlePrimaryKey(entity);
  if (pk.type.kind === "scalar" && pk.type.scalar === "uuid") return { call: `${p}ParseUUIDID`, goType: "string" };
  if (pk.type.kind === "scalar" && pk.type.scalar === "integer") return { call: `${p}ParseIntID`, goType: "int" };
  if (pk.type.kind === "scalar" && pk.type.scalar === "bigint") return { call: `${p}ParseInt64ID`, goType: "int64" };
  return { call: `${p}ParseStringID`, goType: "string" };
}

export function idFunc(resource: ResourceIR): string {
  return `${exported(resource.name)}ID`;
}

export function inputVar(resource: ResourceIR, kind: "create" | "update"): string {
  return `${exported(resource.name)}${cap(kind)}Input`;
}

export function queryVar(resource: ResourceIR): string {
  return `${exported(resource.name)}ListQuery`;
}

/** `PostsPublishInput`: the validated body shape of an action */
export function actionInputVar(action: ActionIR): string {
  return `${exported(action.handler)}Input`;
}

/** generated/validation/resources.go: id parsers, body shapes and query shapes per resource. */
export function validationResourcesFile(ir: IR, modulePath: string): string {
  const sections: string[] = [];
  for (const resource of ir.resources) {
    const entity = entityByName(ir, resource.entity);
    const id = idParser(entity, "");
    sections.push(`// ${idFunc(resource)} parses a ${resource.name} id from the path.
func ${idFunc(resource)}(raw string) (${id.goType}, bool) {
	return ${id.call}(raw)
}`);
    for (const op of resource.operations) {
      if (op.kind === "create" || op.kind === "update") {
        const fields = op.fields.map(f => fieldLiteral(ir, column(entity, f), op.kind, ""));
        sections.push(`// ${inputVar(resource, op.kind)} validates ${op.method} ${op.path} bodies.
var ${inputVar(resource, op.kind)} = ${objectLiteral(fields, "")}`);
      }
      if (op.kind === "list") {
        sections.push(`// ${queryVar(resource)} validates the ${op.method} ${op.path} query string.
var ${queryVar(resource)} = ${queryLiteral(ir, entity, op)}`);
      }
    }
  }
  for (const action of ir.actions) {
    const fields = action.input.map(c => fieldLiteral(ir, c, "create", ""));
    sections.push(`// ${actionInputVar(action)} validates ${action.method} ${action.path} bodies.
var ${actionInputVar(action)} = ${objectLiteral(fields, "")}`);
  }
  return goFile(
    modulePath,
    HEADER("Input validation for every resource operation."),
    "validation",
    [],
    sections.join("\n\n")
  );
}

function queryLiteral(ir: IR, entity: EntityIR, op: Extract<OperationIR, { kind: "list" }>): string {
  const extras: string[] = [];
  if (op.sortable.length) extras.push(`Sortable: []string{${op.sortable.map(q).join(", ")}}`);
  if (op.search.length) extras.push("Search: true");
  const tail = extras.length ? `, ${extras.join(", ")}` : "";
  if (op.filters.length === 0) return `Query{PageSize: ${op.pageSize}${tail}}`;
  const filters = op.filters.map(f => `\t{Name: ${q(f)}, Type: ${typeExpr(ir, column(entity, f), "filter", "")}},`);
  return `Query{PageSize: ${op.pageSize}, Filters: []Filter{\n${filters.join("\n")}\n}${tail}}`;
}
