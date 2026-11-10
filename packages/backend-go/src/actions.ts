import type { ActionIR, ColumnIR, GeneratedFile, IR } from "@osl/core";
import { toPascalCase } from "@osl/core";
import {
  HEADER,
  SCAFFOLD_HEADER,
  dbType,
  dbTypeImport,
  entityByName,
  exported,
  goFile,
  goStruct,
  importsForType,
  inputGoType,
  isNilable,
  packageName,
  q,
  typeName,
  zeroValue
} from "./util.js";

/** `PostsPublishInput`: the typed input struct of an action */
export function actionInputType(action: ActionIR): string {
  return `${exported(action.handler)}Input`;
}

/** `PostsUnpublishAllResult`: the typed result struct of an action with declared fields */
export function actionResultType(action: ActionIR): string {
  return `${exported(action.handler)}Result`;
}

/** `ParsePostsPublishInput` */
export function actionParseFunc(action: ActionIR): string {
  return `Parse${actionInputType(action)}`;
}

/** The Go type a handler answers for an action: the entity row, nothing, or the declared result struct */
export function actionResultGo(ir: IR, action: ActionIR, p = "actions."): string | null {
  if (action.returns.kind === "entity") return `*models.${typeName(entityByName(ir, action.entity!))}`;
  if (action.returns.kind === "none") return null;
  return `${p}${actionResultType(action)}`;
}

/** The handler signature without the func name: (ctx *actions.Context, input actions.XInput, row *models.T) (*models.T, error) */
export function actionSignature(ir: IR, action: ActionIR, p = "actions."): string {
  const params = [`ctx *${p}Context`, `input ${p}${actionInputType(action)}`];
  if (action.scope === "row") params.push(`row *models.${typeName(entityByName(ir, action.entity!))}`);
  const result = actionResultGo(ir, action, p);
  return `(${params.join(", ")}) ${result ? `(${result}, error)` : "error"}`;
}

/** The user-owned package of a handler and its import spec */
export function handlerPackage(action: ActionIR, modulePath: string): { pkg: string; spec: string } {
  const pkg = packageName(action.handler);
  return { pkg, spec: `${pkg} ${modulePath}/src/actions/${action.handler}` };
}

function fieldStruct(name: string, columns: ColumnIR[], doc: string, imports: Set<string>, tagged: boolean): string {
  const fields = columns.map(c => {
    const type = inputGoType(c);
    for (const i of importsForType(type)) imports.add(i);
    return tagged ? { name: exported(c.name), type, tag: `\`json:${q(c.name)}\`` } : { name: exported(c.name), type };
  });
  if (fields.length === 0) return `// ${doc}\ntype ${name} struct{}`;
  return goStruct(name, fields, doc);
}

/** The body of ParseXInput: typed reads out of the validated values */
function parseBody(columns: ColumnIR[]): string {
  if (columns.length === 0) return "\t_ = values\n\treturn input";
  const lines = columns.map(c => {
    const type = inputGoType(c);
    const field = `input.${exported(c.name)}`;
    if (type.startsWith("*")) {
      const base = type.slice(1);
      return `\tif v, ok := values[${q(c.name)}]; ok && v != nil {\n\t\tvalue := v.(${base})\n\t\t${field} = &value\n\t}`;
    }
    return `\tif v, ok := values[${q(c.name)}]; ok && v != nil {\n\t\t${field} = v.(${type})\n\t}`;
  });
  return `${lines.join("\n")}\n\treturn input`;
}

/** generated/actions/actions.go: the handler context, one typed input per action, and the result structs. */
export function actionsFile(ir: IR, modulePath: string): string {
  const imports = new Set<string>([
    "context",
    "time",
    "github.com/gin-gonic/gin",
    dbTypeImport(ir, modulePath),
    `${modulePath}/generated/auth`,
    `${modulePath}/generated/models`
  ]);
  const sections: string[] = [];
  sections.push(`// Context is what a handler gets besides its input and row: the request (nil when a schedule or timer runs the
// action), the caller's session (nil then too), the database, and the time the request or job runs at.
type Context struct {
	Gin     *gin.Context
	Ctx     context.Context
	Session *auth.Session
	DB      ${dbType(ir)}
	// Now is when the action runs; a timer or schedule passes the time it was due. Compare against it, not the clock.
	Now time.Time
}

// Context is the request's context, or the job's when the queue runs the action.
func (c *Context) Context() context.Context {
	if c.Gin != nil {
		return c.Gin.Request.Context()
	}
	if c.Ctx != nil {
		return c.Ctx
	}
	return context.Background()
}`);
  for (const action of ir.actions) {
    const input = actionInputType(action);
    sections.push(
      fieldStruct(
        input,
        action.input,
        `${input} is the validated body of ${action.method} ${action.path}.`,
        imports,
        false
      )
    );
    sections.push(`// ${actionParseFunc(action)} reads the validated values into the typed input.
func ${actionParseFunc(action)}(values models.Values) ${input} {
	var input ${input}
${parseBody(action.input)}
}`);
    if (action.returns.kind === "fields") {
      sections.push(
        fieldStruct(
          actionResultType(action),
          action.returns.fields,
          `${actionResultType(action)} is what the ${action.name} action answers with.`,
          imports,
          true
        )
      );
    }
  }
  return goFile(
    modulePath,
    HEADER("Actions: the context handlers receive, their typed inputs and results."),
    "actions",
    imports,
    sections.join("\n\n")
  );
}

/** generated/actions/handlers/handlers.go: the registry of the handlers you own; a wrong signature fails to compile here. */
export function actionHandlersFile(ir: IR, modulePath: string): string {
  const imports = new Set<string>([`${modulePath}/generated/actions`]);
  if (ir.actions.some(a => a.scope === "row" || a.returns.kind === "entity"))
    imports.add(`${modulePath}/generated/models`);
  const sections = ir.actions.map(action => {
    const { pkg, spec } = handlerPackage(action, modulePath);
    imports.add(spec);
    return `// ${exported(action.handler)} handles ${action.method} ${action.path}; its body is src/actions/${action.handler}/handler.go.
var ${exported(action.handler)} func${actionSignature(ir, action)} = ${pkg}.Handle`;
  });
  return goFile(
    modulePath,
    HEADER("Registry of the action handlers in src/actions. A handler with the wrong signature fails to compile here."),
    "handlers",
    imports,
    sections.join("\n\n")
  );
}

/** A zero value of a result field, for the handler stub */
function resultZero(c: ColumnIR): string {
  const type = inputGoType(c);
  if (isNilable(type)) return "nil";
  return zeroValue(type);
}

/** src/actions/<handler>/handler.go, created once per action */
export function actionScaffolds(ir: IR, modulePath: string): GeneratedFile[] {
  return ir.actions.map(action => {
    const entity = action.entity ? entityByName(ir, action.entity) : null;
    const T = entity ? typeName(entity) : null;
    const imports = new Set<string>([`${modulePath}/generated/actions`]);
    if (action.scope === "row" || action.returns.kind === "entity") imports.add(`${modulePath}/generated/models`);
    let stub: string;
    if (action.returns.kind === "entity") {
      if (action.scope === "row") stub = "\treturn row, nil";
      else {
        imports.add("errors");
        stub = `\treturn nil, errors.New("return the ${T} this action answers with")`;
      }
    } else if (action.returns.kind === "none") stub = "\treturn nil";
    else {
      const literal = action.returns.fields.map(f => `${exported(f.name)}: ${resultZero(f)}`).join(", ");
      for (const f of action.returns.fields) for (const i of importsForType(inputGoType(f))) imports.add(i);
      stub = `\treturn actions.${actionResultType(action)}{${literal}}, nil`;
    }
    const where =
      action.scope === "row"
        ? `${action.method} ${action.path}: row is the ${T}; answer with the row to return it.`
        : action.scope === "collection"
          ? `${action.method} ${action.path}, over the whole collection.`
          : `${action.method} ${action.path}.`;
    return {
      path: `src/actions/${action.handler}/handler.go`,
      mode: "scaffold" as const,
      content: goFile(
        modulePath,
        SCAFFOLD_HEADER(`${action.description ?? toPascalCase(action.name)}. ${where}`),
        packageName(action.handler),
        imports,
        `// Handle runs the ${action.name} action. Return an *httpx.Error to answer with that status; ctx.DB is the pgx pool.
func Handle${actionSignature(ir, action)} {
${stub}
}
`
      )
    };
  });
}
