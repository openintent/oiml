import type { ColumnIR, EntityIR, IR } from "@osl/core";
import { pluralize } from "@osl/core";
import {
  HEADER,
  exported,
  goFile,
  goStruct,
  importsForType,
  isBytes,
  publicColumns,
  publicGoType,
  q,
  quoteIdent,
  rowGoType,
  typeName
} from "./util.js";

/** generated/models/values.go: shared helpers, static. */
export function valuesFile(modulePath: string): string {
  return goFile(
    modulePath,
    HEADER("Shared helpers for rows and values."),
    "models",
    ["github.com/jackc/pgx/v5"],
    `// Values holds column values keyed by column name: validated input, or a hook's patch.
type Values map[string]any

// Scanner is satisfied by pgx.Row and pgx.Rows.
type Scanner interface {
	Scan(dest ...any) error
}

// Collect scans every row with scan and closes rows.
func Collect[T any](rows pgx.Rows, scan func(Scanner) (*T, error)) ([]*T, error) {
	defer rows.Close()
	out := make([]*T, 0)
	for rows.Next() {
		item, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// Lookup reads a map by an optional key; a nil key finds nothing.
func Lookup[K comparable, V any](m map[K]*V, key *K) *V {
	if key == nil {
		return nil
	}
	return m[*key]
}

// Slice turns a nil slice into an empty one so it renders as [] rather than null.
func Slice[T any](items []T) []T {
	if items == nil {
		return []T{}
	}
	return items
}
`
  );
}

/** generated/models/format.go: date and time rendering, static. */
export function formatFile(modulePath: string): string {
  return goFile(
    modulePath,
    HEADER("Rendering of dates and times in API responses."),
    "models",
    ["fmt", "time", "github.com/jackc/pgx/v5/pgtype"],
    `// FormatDateTime renders a timestamp as RFC 3339 with milliseconds, in UTC.
func FormatDateTime(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

// FormatDateTimePtr renders an optional timestamp.
func FormatDateTimePtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := FormatDateTime(*t)
	return &s
}

// FormatDateTimes renders a list of timestamps; nil stays nil.
func FormatDateTimes(items []time.Time) []string {
	if items == nil {
		return nil
	}
	out := make([]string, len(items))
	for i, item := range items {
		out[i] = FormatDateTime(item)
	}
	return out
}

// FormatDate renders a date as YYYY-MM-DD.
func FormatDate(t time.Time) string {
	return t.Format("2006-01-02")
}

// FormatDatePtr renders an optional date.
func FormatDatePtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := FormatDate(*t)
	return &s
}

// FormatDates renders a list of dates; nil stays nil.
func FormatDates(items []time.Time) []string {
	if items == nil {
		return nil
	}
	out := make([]string, len(items))
	for i, item := range items {
		out[i] = FormatDate(item)
	}
	return out
}

// FormatTime renders a time of day as HH:MM:SS, with microseconds when they are not zero.
func FormatTime(t pgtype.Time) string {
	micros := t.Microseconds
	hours := micros / 3600000000
	minutes := (micros / 60000000) % 60
	seconds := (micros / 1000000) % 60
	fraction := micros % 1000000
	if fraction == 0 {
		return fmt.Sprintf("%02d:%02d:%02d", hours, minutes, seconds)
	}
	return fmt.Sprintf("%02d:%02d:%02d.%06d", hours, minutes, seconds, fraction)
}

// FormatTimePtr renders an optional time of day.
func FormatTimePtr(t *pgtype.Time) *string {
	if t == nil {
		return nil
	}
	s := FormatTime(*t)
	return &s
}

// FormatTimes renders a list of times of day; nil stays nil.
func FormatTimes(items []pgtype.Time) []string {
	if items == nil {
		return nil
	}
	out := make([]string, len(items))
	for i, item := range items {
		out[i] = FormatTime(item)
	}
	return out
}
`
  );
}

export function tableConst(entity: EntityIR): string {
  return `${typeName(entity)}Table`;
}

export function columnsConst(entity: EntityIR): string {
  return `${typeName(entity)}Columns`;
}

export function publicType(entity: EntityIR): string {
  return `Public${typeName(entity)}`;
}

export function scanFunc(entity: EntityIR): string {
  return `Scan${typeName(entity)}`;
}

export function presentFunc(entity: EntityIR): string {
  return `Present${typeName(entity)}`;
}

export function presentPtrFunc(entity: EntityIR): string {
  return `Present${typeName(entity)}Ptr`;
}

export function presentManyFunc(entity: EntityIR): string {
  return `Present${pluralize(typeName(entity))}`;
}

/** Expression presenting one column of `row` in the public shape */
function presentExpr(col: ColumnIR): string {
  const field = `row.${exported(col.name)}`;
  const t = col.type;
  if (t.kind === "array") {
    let expr = field;
    if (t.of === "datetime") expr = `FormatDateTimes(${field})`;
    else if (t.of === "date") expr = `FormatDates(${field})`;
    else if (t.of === "time") expr = `FormatTimes(${field})`;
    return col.nullable ? expr : `Slice(${expr})`;
  }
  if (t.kind === "scalar") {
    if (t.scalar === "datetime") return col.nullable ? `FormatDateTimePtr(${field})` : `FormatDateTime(${field})`;
    if (t.scalar === "date") return col.nullable ? `FormatDatePtr(${field})` : `FormatDate(${field})`;
    if (t.scalar === "time") return col.nullable ? `FormatTimePtr(${field})` : `FormatTime(${field})`;
  }
  if (t.kind === "file") return col.nullable ? `PresentFileRefPtr(${field})` : `PresentFileRef(${field})`;
  return field;
}

/** generated/models/files.go: the stored snapshot of a file field and its public shape. Static. */
export function modelFilesFile(modulePath: string): string {
  return goFile(
    modulePath,
    HEADER("File fields: the snapshot a column stores and the shape the API answers."),
    "models",
    [],
    `// FileRef is what a file column stores: a snapshot of the osl_files row at the time of the write.
type FileRef struct {
	ID   string \`json:"id"\`
	Key  string \`json:"key"\`
	Name string \`json:"name"\`
	Size int    \`json:"size"\`
	Type string \`json:"type"\`
}

// PublicFile is a file as the API answers it: the snapshot without its storage key, plus the URL that serves it.
type PublicFile struct {
	ID   string \`json:"id"\`
	Name string \`json:"name"\`
	Size int    \`json:"size"\`
	Type string \`json:"type"\`
	URL  string \`json:"url"\`
}

// FileURL is where the API serves a file's bytes: local files are streamed, S3 files redirect to a signed URL.
func FileURL(id string) string {
	return "/api/files/" + id + "/content"
}

// PresentFileRef is the public shape of a stored file snapshot.
func PresentFileRef(ref FileRef) PublicFile {
	return PublicFile{ID: ref.ID, Name: ref.Name, Size: ref.Size, Type: ref.Type, URL: FileURL(ref.ID)}
}

// PresentFileRefPtr presents an optional snapshot; nil stays nil.
func PresentFileRefPtr(ref *FileRef) *PublicFile {
	if ref == nil {
		return nil
	}
	out := PresentFileRef(*ref)
	return &out
}
`
  );
}

/** generated/models/entities.go: one row struct, public struct, scanner and presenters per entity. */
export function entitiesFile(ir: IR, modulePath: string): string {
  const imports = new Set<string>();
  const sections: string[] = [];
  for (const entity of ir.entities) {
    const T = typeName(entity);
    const pub = publicColumns(entity);
    const rowFields = entity.columns.map(c => {
      const type = rowGoType(c);
      for (const i of importsForType(type)) imports.add(i);
      return { name: exported(c.name), type, tag: c.hidden || isBytes(c) ? '`json:"-"`' : `\`json:${q(c.name)}\`` };
    });
    const publicFields = pub.map(c => {
      const type = publicGoType(c);
      for (const i of importsForType(type)) imports.add(i);
      return { name: exported(c.name), type, tag: `\`json:${q(c.name)}\`` };
    });
    const scanTargets = entity.columns.map(c => `&r.${exported(c.name)}`).join(", ");
    const presentPairs = pub.map(c => `${exported(c.name)}: ${presentExpr(c)}`).join(", ");
    sections.push(`// ${tableConst(entity)} is the quoted table of ${entity.name}.
const ${tableConst(entity)} = ${goRaw(quoteIdent(entity.table))}

// ${columnsConst(entity)} lists the columns of ${entity.name} in model order, for SELECT and RETURNING.
const ${columnsConst(entity)} = ${goRaw(entity.columns.map(c => quoteIdent(c.name)).join(", "))}

${goStruct(T, rowFields, `${T} is a row of ${entity.table}.`)}

${goStruct(publicType(entity), publicFields, `${publicType(entity)} is ${T} as the API returns it: hidden columns removed, dates rendered.`)}

// ${scanFunc(entity)} reads one ${T} from a row selected with ${columnsConst(entity)}.
func ${scanFunc(entity)}(row Scanner) (*${T}, error) {
	var r ${T}
	if err := row.Scan(${scanTargets}); err != nil {
		return nil, err
	}
	return &r, nil
}

// ${presentFunc(entity)} returns the public shape of a ${T}.
func ${presentFunc(entity)}(row *${T}) ${publicType(entity)} {
	return ${publicType(entity)}{${presentPairs}}
}

// ${presentPtrFunc(entity)} presents an optional ${T}; nil stays nil.
func ${presentPtrFunc(entity)}(row *${T}) *${publicType(entity)} {
	if row == nil {
		return nil
	}
	out := ${presentFunc(entity)}(row)
	return &out
}

// ${presentManyFunc(entity)} presents a list of ${T}, never nil.
func ${presentManyFunc(entity)}(rows []*${T}) []${publicType(entity)} {
	out := make([]${publicType(entity)}, 0, len(rows))
	for _, row := range rows {
		out = append(out, ${presentFunc(entity)}(row))
	}
	return out
}`);
  }
  return goFile(
    modulePath,
    HEADER("Row types, scanners and public shapes of every entity."),
    "models",
    imports,
    sections.join("\n\n")
  );
}

/** Go raw string literal for SQL fragments (they never contain backticks) */
function goRaw(text: string): string {
  return "`" + text + "`";
}
