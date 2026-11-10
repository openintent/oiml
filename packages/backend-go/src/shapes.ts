import type { ColumnIR, EntityIR, IR, ResourceIR, ShapeKeyIR } from "@osl/core";
import { shapedColumns } from "@osl/core";
import { HEADER, exported, goFile, goStruct, q, typeName } from "./util.js";

/** Whether the model has a JSON column with a shape, one or one per enum value */
export function hasShapes(ir: IR): boolean {
  return ir.entities.some(e => shapedColumns(e).length > 0);
}

/** generated/validation/shape.go: a JSON object held to declared keys. Static; only with a shaped column. */
export function shapeRuntimeFile(modulePath: string): string {
  return goFile(
    modulePath,
    HEADER("Validation of JSON values with a declared shape."),
    "validation",
    ["encoding/json", "sort"],
    `// Key is one key of a shape. A key is there with a value of its type or it is not there: null is no value.
type Key struct {
	Name     string
	Required bool
	// Default is written when the key is left out, as JSON; nil for a key without one.
	Default json.RawMessage
	Type    Type
}

// Shape validates a JSON object against its declared keys. A key the shape does not name is refused under its
// own path, and so is a wrong type at any depth; what it answers is the value as it is stored, defaults filled in.
type Shape struct {
	Keys []Key
}

func (s Shape) Parse(path string, raw json.RawMessage) (any, []Issue) {
	var body map[string]json.RawMessage
	if isNull(raw) || json.Unmarshal(raw, &body) != nil {
		return nil, []Issue{{Path: path, Message: "Expected object"}}
	}
	var issues []Issue
	out := make(map[string]json.RawMessage, len(s.Keys))
	known := make(map[string]bool, len(s.Keys))
	for _, key := range s.Keys {
		known[key.Name] = true
		at := path + "." + key.Name
		value, present := body[key.Name]
		if !present {
			if key.Required {
				issues = append(issues, Issue{Path: at, Message: "Required"})
			} else if key.Default != nil {
				out[key.Name] = key.Default
			}
			continue
		}
		if isNull(value) {
			issues = append(issues, Issue{Path: at, Message: "Expected a value, received null"})
			continue
		}
		parsed, problems := key.Type.Parse(at, value)
		if len(problems) > 0 {
			issues = append(issues, problems...)
			continue
		}
		// A nested shape answers its own value with its defaults; anything else is kept as it was written
		if nested, ok := parsed.(json.RawMessage); ok {
			if _, isShape := key.Type.(Shape); isShape {
				value = nested
			}
		}
		out[key.Name] = value
	}
	unknown := make([]string, 0)
	for name := range body {
		if !known[name] {
			unknown = append(unknown, name)
		}
	}
	sort.Strings(unknown)
	for _, name := range unknown {
		issues = append(issues, Issue{Path: path + "." + name, Message: "Unrecognized key"})
	}
	if len(issues) > 0 {
		return nil, issues
	}
	encoded, err := json.Marshal(out)
	if err != nil {
		return nil, []Issue{{Path: path, Message: "Expected object"}}
	}
	return json.RawMessage(encoded), nil
}

func (s Shape) ParseString(path string, value string) (any, []Issue) {
	return value, nil
}

func (s Shape) Slice(items []any) any {
	return collect[json.RawMessage](items)
}
`
  );
}

function scalarType(kind: string, key: ShapeKeyIR, p: string): string {
  const v = key.validate ?? {};
  const bounds = (): string => {
    const parts: string[] = [];
    if (v.min !== undefined) parts.push(`Min: ${p}F(${v.min})`);
    if (v.max !== undefined) parts.push(`Max: ${p}F(${v.max})`);
    return parts.join(", ");
  };
  switch (kind) {
    case "string":
    case "text": {
      const parts: string[] = [];
      if (v.min_length !== undefined && v.min_length > 0) parts.push(`MinLength: ${v.min_length}`);
      const max = v.max_length ?? key.maxLength;
      if (max !== undefined) parts.push(`MaxLength: ${max}`);
      if (v.format) parts.push(`Format: ${q(v.format)}`);
      if (v.pattern) parts.push(`Pattern: ${p}Regexp(${q(v.pattern)})`);
      return `${p}String{${parts.join(", ")}}`;
    }
    case "integer":
      return `${p}Integer{${bounds()}}`;
    case "float":
      return `${p}Float{${bounds()}}`;
    case "boolean":
      return `${p}Boolean{}`;
    case "date":
      return `${p}Date{}`;
    case "datetime":
      return `${p}DateTime{}`;
    case "uuid":
      return `${p}UUID{}`;
    default:
      throw new Error(`no validation type for a shape key of kind ${kind}`);
  }
}

function keyLiteral(key: ShapeKeyIR, p: string, indent: string): string {
  const type =
    key.kind === "object"
      ? shapeLiteral(key.keys ?? [], p, `${indent}\t`)
      : key.kind === "enum"
        ? `${p}Enum{Values: []string{${(key.values ?? []).map(q).join(", ")}}}`
        : key.kind === "array"
          ? `${p}Array{Of: ${scalarType(key.of ?? "string", key, p)}}`
          : scalarType(key.kind, key, p);
  const parts = [`Name: ${q(key.name)}`];
  if (key.required) parts.push("Required: true");
  if (key.default !== undefined) parts.push(`Default: json.RawMessage(${q(JSON.stringify(key.default))})`);
  parts.push(`Type: ${type}`);
  return `{${parts.join(", ")}}`;
}

/** A validation.Shape literal for a declared shape */
export function shapeLiteral(keys: ShapeKeyIR[], p = "validation.", indent = ""): string {
  if (!keys.length) return `${p}Shape{}`;
  return `${p}Shape{Keys: []${p}Key{\n${keys.map(key => `${indent}\t${keyLiteral(key, p, indent)},`).join("\n")}\n${indent}}}`;
}

/** Whether a shape literal names a default, so the file that holds it imports encoding/json */
export function shapeUsesJson(keys: ShapeKeyIR[]): boolean {
  return keys.some(key => key.default !== undefined || shapeUsesJson(key.keys ?? []));
}

/** `IntegrationsConfigShapes`: the shapes of a column with one per enum value, by value */
export function shapesVar(resource: ResourceIR, col: ColumnIR): string {
  return `${exported(resource.name)}${exported(col.name)}Shapes`;
}

function scalarGo(kind: string): string {
  switch (kind) {
    case "integer":
      return "int";
    case "float":
      return "float64";
    case "boolean":
      return "bool";
    default:
      return "string";
  }
}

function shapeStructs(name: string, keys: ShapeKeyIR[], doc: string): string[] {
  const nested: string[] = [];
  const fields = keys.map(key => {
    const always = key.required || key.default !== undefined;
    let type: string;
    if (key.kind === "object") {
      const inner = `${name}${exported(key.name)}`;
      nested.push(...shapeStructs(inner, key.keys ?? [], `${inner} is the ${key.name} of ${name}.`));
      type = always ? inner : `*${inner}`;
    } else if (key.kind === "array") type = `[]${scalarGo(key.of ?? "string")}`;
    else if (key.kind === "enum") type = always ? "string" : "*string";
    else type = always ? scalarGo(key.kind) : `*${scalarGo(key.kind)}`;
    return { name: exported(key.name), type, tag: `\`json:${q(always ? key.name : `${key.name},omitempty`)}\`` };
  });
  return [goStruct(name, fields, doc), ...nested];
}

/**
 * generated/models/shapes.go: a struct per declared shape. A row keeps its JSON as it is stored
 * (json.RawMessage), so the API answers a value written before its shape as it is; a handler that wants the
 * keys decodes into one of these.
 */
export function shapeModelsFile(ir: IR, modulePath: string): string {
  const sections: string[] = [];
  for (const entity of ir.entities) {
    for (const col of shapedColumns(entity)) {
      const base = `${typeName(entity)}${exported(col.name)}`;
      if (col.shape)
        sections.push(
          ...shapeStructs(
            base,
            col.shape,
            `${base} is what ${entity.name}.${col.name} holds: decode a row's ${exported(col.name)} into it with json.Unmarshal.`
          )
        );
      for (const shape of col.shapeBy?.shapes ?? []) {
        const name = `${base}${exported(shape.value)}`;
        sections.push(
          ...shapeStructs(
            name,
            shape.keys,
            `${name} is what ${entity.name}.${col.name} holds on a row whose ${col.shapeBy!.column} is ${shape.value}.`
          )
        );
      }
    }
  }
  return goFile(
    modulePath,
    HEADER("The declared shapes of JSON columns, as structs a handler decodes a stored value into."),
    "models",
    [],
    sections.join("\n\n")
  );
}

/**
 * What a create or an update runs once it holds the parsed body (and, for an update, the row): a value whose
 * shape follows an enum is held to the shape of the enum value its row will have, and an update that changes the
 * enum without sending the value is refused when the row has one. Empty when the operation touches no such column.
 */
export function shapeGuard(
  entity: EntityIR,
  resource: ResourceIR,
  fields: string[],
  mode: "create" | "update",
  values: string
): string {
  const out: string[] = [];
  for (const col of entity.columns) {
    if (!col.shapeBy) continue;
    const by = entity.columns.find(c => c.name === col.shapeBy!.column)!;
    const sendsValue = fields.includes(col.name);
    const sendsBy = fields.includes(by.name);
    if (mode === "create" ? !sendsValue : !sendsValue && !sendsBy) continue;
    const fallback =
      mode === "update"
        ? `existing.${exported(by.name)}`
        : by.default?.kind === "literal"
          ? q(String(by.default.value))
          : undefined;
    if (!sendsBy && fallback === undefined) continue;
    const kind = `${col.name.replace(/_(\w)/g, (_, c: string) => c.toUpperCase())}By`;
    const lines = [
      `\t// ${col.name} follows ${by.name}: a written value is held to the shape of the ${by.name} its row will have`
    ];
    if (sendsBy && fallback !== undefined)
      lines.push(
        `\t${kind} := ${fallback}`,
        `\tif next, ok := ${values}[${q(by.name)}].(string); ok {`,
        `\t\t${kind} = next`,
        `\t}`
      );
    else if (sendsBy) lines.push(`\t${kind}, _ := ${values}[${q(by.name)}].(string)`);
    else lines.push(`\t${kind} := ${fallback}`);
    const message = `${by.name} changes, so ${col.name} must be sent with it: a value fits the shape of one ${by.name}`;
    const changed =
      mode === "update" && sendsBy
        ? `${kind} != existing.${exported(by.name)}${col.nullable ? ` && existing.${exported(col.name)} != nil` : ""}`
        : null;
    if (sendsValue) {
      lines.push(
        `\tif raw, ok := ${values}[${q(col.name)}].(json.RawMessage); ok {`,
        `\t\tfitted, problems := validation.${shapesVar(resource, col)}[${kind}].Parse(${q(col.name)}, raw)`,
        `\t\tif len(problems) > 0 {`,
        `\t\t\thttpx.Fail(c, httpx.Validation("Request body is invalid", problems))`,
        `\t\t\treturn`,
        `\t\t}`,
        `\t\t${values}[${q(col.name)}] = fitted`
      );
      if (changed)
        lines.push(
          `\t} else if _, sent := ${values}[${q(col.name)}]; !sent && ${changed} {`,
          `\t\thttpx.Fail(c, httpx.Validation("Request body is invalid", []validation.Issue{{Path: ${q(col.name)}, Message: ${q(message)}}}))`,
          `\t\treturn`
        );
      lines.push(`\t}`);
    } else if (changed) {
      lines.push(
        `\tif ${changed} {`,
        `\t\thttpx.Fail(c, httpx.Validation("Request body is invalid", []validation.Issue{{Path: ${q(col.name)}, Message: ${q(message)}}}))`,
        `\t\treturn`,
        `\t}`
      );
    } else lines.push(`\t_ = ${kind}`);
    out.push(lines.join("\n") + "\n");
  }
  return out.join("");
}
