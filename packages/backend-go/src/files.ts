import type { IR, RuleIR } from "@osl/core";
import { columnsConst, presentFunc, scanFunc, tableConst } from "./models.js";
import {
  HEADER,
  dbType,
  dbTypeImport,
  entityByName,
  exported,
  goFile,
  ruleLiteral,
  singlePrimaryKey,
  typeName
} from "./util.js";

/** generated/files/files.go: uploads as a two-step flow (begin, PUT the bytes, complete), metadata reads, and file-field checks. */
export function filesFile(ir: IR, modulePath: string): string {
  const entity = entityByName(ir, "OslFile");
  const T = typeName(entity);
  const owner = entity.columns.find(c => c.name === "owner_id");
  const tableC = `models.${tableConst(entity)}`;
  const columnsC = `models.${columnsConst(entity)}`;
  const scan = `models.${scanFunc(entity)}`;
  return goFile(
    modulePath,
    HEADER(
      "Files: begin an upload, receive or redirect to its bytes, read its metadata, and check file fields on writes."
    ),
    "files",
    [
      "context",
      "crypto/rand",
      "errors",
      "fmt",
      "io",
      "net/http",
      "os",
      "strconv",
      "strings",
      "github.com/jackc/pgx/v5",
      ...(ir.auth?.tenancy?.isolation ? [] : ["github.com/jackc/pgx/v5/pgxpool"]),
      `${modulePath}/generated/db`,
      `${modulePath}/generated/httpx`,
      `${modulePath}/generated/models`,
      `${modulePath}/generated/storage`,
      `${modulePath}/generated/validation`
    ],
    `// FieldSpec describes a file field of an entity: its column, the content types it accepts (image/* style
// wildcards) and the largest size it takes in bytes (0 for no limit).
type FieldSpec struct {
	Column  string
	Accept  []string
	MaxSize int
}

// Record is a file as the API answers it.
type Record struct {
	ID     string \`json:"id"\`
	Name   string \`json:"name"\`
	Size   int    \`json:"size"\`
	Type   string \`json:"type"\`
	URL    string \`json:"url"\`
	Status string \`json:"status"\`
}

// Begun is the reply to POST /api/files: the pending record and where to PUT its bytes.
type Begun struct {
	Record
	Upload storage.UploadTarget \`json:"upload"\`
}

// MaxUploadBytes is the largest upload Begin accepts (OSL_MAX_UPLOAD_BYTES, default 50 MB); fields may lower it.
func MaxUploadBytes() int {
	if v, err := strconv.Atoi(os.Getenv("OSL_MAX_UPLOAD_BYTES")); err == nil && v > 0 {
		return v
	}
	return 50 * 1024 * 1024
}

// Present is the public shape of a file row.
func Present(row *models.${T}) Record {
	return Record{ID: row.ID, Name: row.Name, Size: row.Size, Type: row.Type, URL: models.FileURL(row.ID), Status: row.Status}
}

// Begin creates the file record and says where the bytes go. The record stays pending until the bytes are in place.
func Begin(ctx context.Context, pool ${dbType(ir)}, name string, contentType string, size int, owner any) (*Begun, error) {
	if size > MaxUploadBytes() {
		return nil, httpx.NewError(http.StatusBadRequest, "validation", "Files may be at most "+strconv.Itoa(MaxUploadBytes())+" bytes")
	}
	id := newID()
	key := "files/" + id
	values := models.Values{"id": id, "key": key, "name": name, "size": size, "type": contentType, "status": "pending"}
${owner ? `\tvalues["owner_id"] = owner\n` : "\t_ = owner\n"}	sql, args := db.Insert(${tableC}, values, ${columnsC})
	row, err := ${scan}(pool.QueryRow(ctx, sql, args...))
	if err != nil {
		return nil, err
	}
	target, err := storage.Target(ctx, key, contentType, models.FileURL(id))
	if err != nil {
		return nil, err
	}
	return &Begun{Record: Present(row), Upload: target}, nil
}

// newID is a random UUID (version 4).
func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// Row loads a file by id; a malformed or unknown id is not found.
func Row(ctx context.Context, pool ${dbType(ir)}, id string) (*models.${T}, error) {
	if _, ok := validation.ParseUUIDID(id); !ok {
		return nil, httpx.NotFound()
	}
	row, err := ${scan}(pool.QueryRow(ctx, \`SELECT \`+${columnsC}+\` FROM \`+${tableC}+\` WHERE "id" = $1\`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, httpx.NotFound()
	}
	return row, err
}

func markReady(ctx context.Context, pool ${dbType(ir)}, id string, size int64) (Record, error) {
	row, err := ${scan}(pool.QueryRow(ctx, \`UPDATE \`+${tableC}+\` SET "status" = 'ready', "size" = $2 WHERE "id" = $1 RETURNING \`+${columnsC}, id, size))
	if err != nil {
		return Record{}, err
	}
	return Present(row), nil
}

// Complete marks an upload finished once its bytes are in storage; the stored size wins over the declared one.
func Complete(ctx context.Context, pool ${dbType(ir)}, id string) (Record, error) {
	row, err := Row(ctx, pool, id)
	if err != nil {
		return Record{}, err
	}
	if row.Status == "ready" {
		return Present(row), nil
	}
	size, err := storage.Size(ctx, row.Key)
	if err != nil {
		return Record{}, err
	}
	if size < 0 {
		return Record{}, httpx.NewError(http.StatusBadRequest, "upload_incomplete", "The file's bytes have not been uploaded yet")
	}
	return markReady(ctx, pool, id, size)
}

// Get answers a file's metadata.
func Get(ctx context.Context, pool ${dbType(ir)}, id string) (Record, error) {
	row, err := Row(ctx, pool, id)
	if err != nil {
		return Record{}, err
	}
	return Present(row), nil
}

// Receive stores the bytes a client PUTs to the API and marks the file ready. Local storage only.
func Receive(ctx context.Context, pool ${dbType(ir)}, id string, body io.Reader) (Record, error) {
	if storage.CurrentKind() != storage.KindLocal {
		return Record{}, httpx.NewError(http.StatusBadRequest, "not_local", "Upload to the URL from POST /api/files instead")
	}
	row, err := Row(ctx, pool, id)
	if err != nil {
		return Record{}, err
	}
	size, err := storage.PutLocal(row.Key, body)
	if err != nil {
		return Record{}, err
	}
	return markReady(ctx, pool, id, size)
}

// Content is the bytes of a ready file: an open local file, or the signed S3 URL to redirect to.
type Content struct {
	Redirect    string
	File        *os.File
	Type        string
	Size        int64
	Disposition string
}

// Open answers a ready file's bytes. The caller closes File when it is set.
func Open(ctx context.Context, pool ${dbType(ir)}, id string) (*Content, error) {
	row, err := Row(ctx, pool, id)
	if err != nil {
		return nil, err
	}
	if row.Status != "ready" {
		return nil, httpx.NotFound()
	}
	if storage.CurrentKind() == storage.KindLocal {
		file, err := storage.OpenLocal(row.Key)
		if err != nil {
			return nil, err
		}
		return &Content{File: file, Type: row.Type, Size: int64(row.Size), Disposition: storage.ContentDisposition(row.Name, row.Type)}, nil
	}
	target, err := storage.DownloadURL(ctx, row.Key, row.Name, row.Type)
	if err != nil {
		return nil, err
	}
	return &Content{Redirect: target}, nil
}

func typeMatches(pattern string, contentType string) bool {
	if strings.HasSuffix(pattern, "/*") {
		return strings.HasPrefix(strings.ToLower(contentType), strings.ToLower(pattern[:len(pattern)-1]))
	}
	return strings.EqualFold(pattern, contentType)
}

// ResolveRefs replaces the file ids in a validated write body with the files' snapshots, checking each is ready
// and allowed by its field. Fields absent from the body, or set to null, are left as they are.
func ResolveRefs(ctx context.Context, pool ${dbType(ir)}, values models.Values, specs []FieldSpec) error {
	for _, spec := range specs {
		raw, present := values[spec.Column]
		if !present || raw == nil {
			continue
		}
		id, ok := raw.(string)
		if !ok {
			continue
		}
		row, err := ${scan}(pool.QueryRow(ctx, \`SELECT \`+${columnsC}+\` FROM \`+${tableC}+\` WHERE "id" = $1\`, id))
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if row == nil || row.Status != "ready" {
			return httpx.NewError(http.StatusBadRequest, "validation", spec.Column+": no uploaded file with id "+id)
		}
		if len(spec.Accept) > 0 {
			accepted := false
			for _, pattern := range spec.Accept {
				if typeMatches(pattern, row.Type) {
					accepted = true
					break
				}
			}
			if !accepted {
				return httpx.NewError(http.StatusBadRequest, "validation", spec.Column+": "+row.Type+" is not an accepted type ("+strings.Join(spec.Accept, ", ")+")")
			}
		}
		if spec.MaxSize > 0 && row.Size > spec.MaxSize {
			return httpx.NewError(http.StatusBadRequest, "validation", spec.Column+": the file is larger than "+strconv.Itoa(spec.MaxSize)+" bytes")
		}
		values[spec.Column] = &models.FileRef{ID: row.ID, Key: row.Key, Name: row.Name, Size: row.Size, Type: row.Type}
	}
	return nil
}
`
  );
}

/** generated/filesapi/api.go: the REST handlers over the files core. */
export function filesApiFile(ir: IR, modulePath: string): string {
  const entity = entityByName(ir, "OslFile");
  const owner = entity.columns.find(c => c.name === "owner_id");
  const identityPk = ir.auth ? exported(singlePrimaryKey(entityByName(ir, ir.auth.identity)).name) : "ID";
  const ownerLines = owner
    ? `	var owner any
	if session != nil {
		owner = session.User.${identityPk}
	}
	begun, err := files.Begin(ctx, f.db, values["name"].(string), values["type"].(string), values["size"].(int), owner)`
    : `	begun, err := files.Begin(ctx, f.db, values["name"].(string), values["type"].(string), values["size"].(int), nil)`;
  return goFile(
    modulePath,
    HEADER("Files over REST: begin an upload, receive or redirect to its bytes, mark it complete, read its metadata."),
    "filesapi",
    [
      "net/http",
      "github.com/gin-gonic/gin",
      dbTypeImport(ir, modulePath),
      `${modulePath}/generated/access`,
      `${modulePath}/generated/auth`,
      `${modulePath}/generated/files`,
      `${modulePath}/generated/httpx`,
      `${modulePath}/generated/validation`
    ],
    `// Files serves the file endpoints.
type Files struct {
	db   ${dbType(ir)}
	auth *auth.Auth
}

// New builds the handlers.
func New(db ${dbType(ir)}, a *auth.Auth) *Files {
	return &Files{db: db, auth: a}
}

// Routes registers the file endpoints.
func (f *Files) Routes(r gin.IRouter) {
	r.POST("/api/files", f.Begin)
	r.GET("/api/files/:id", f.Get)
	r.POST("/api/files/:id/complete", f.Complete)
	r.GET("/api/files/:id/content", f.Content)
	r.PUT("/api/files/:id/content", f.Receive)
}

var uploadRule = ${ruleLiteral(ir.files!.upload)}

var readRule = ${ruleLiteral(ir.files!.read)}

var beginInput = validation.Object{Fields: []validation.Field{
	{Name: "name", Required: true, Type: validation.String{MinLength: 1, MaxLength: 255}},
	{Name: "type", Required: true, Type: validation.String{MinLength: 1, MaxLength: 255}},
	{Name: "size", Required: true, Type: validation.Integer{Min: validation.F(0)}},
}}

// Begin handles POST /api/files: the file record and where to PUT its bytes.
func (f *Files) Begin(c *gin.Context) {
	ctx := c.Request.Context()
	session, err := f.auth.Session(c)
	if err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
	if verdict := access.Check(uploadRule, session); verdict != nil {
		access.Deny(c, verdict)
		return
	}
	body, perr := httpx.ParseBody(c)
	if perr != nil {
		httpx.Fail(c, perr)
		return
	}
	values, perr := beginInput.Parse(body)
	if perr != nil {
		httpx.Fail(c, perr)
		return
	}
${ownerLines}
	if err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
	httpx.Created(c, begun)
}

// Complete handles POST /api/files/:id/complete.
func (f *Files) Complete(c *gin.Context) {
	session, err := f.auth.Session(c)
	if err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
	if verdict := access.Check(uploadRule, session); verdict != nil {
		access.Deny(c, verdict)
		return
	}
	record, err := files.Complete(c.Request.Context(), f.db, c.Param("id"))
	if err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
	httpx.OK(c, record)
}

// Get handles GET /api/files/:id.
func (f *Files) Get(c *gin.Context) {
	session, err := f.auth.Session(c)
	if err != nil {
		httpx.HandleError(c, err, "read")
		return
	}
	if verdict := access.Check(readRule, session); verdict != nil {
		access.Deny(c, verdict)
		return
	}
	record, err := files.Get(c.Request.Context(), f.db, c.Param("id"))
	if err != nil {
		httpx.HandleError(c, err, "read")
		return
	}
	httpx.OK(c, record)
}

// Content handles GET /api/files/:id/content: the bytes from local storage, or a redirect to a signed S3 URL.
func (f *Files) Content(c *gin.Context) {
	content, err := files.Open(c.Request.Context(), f.db, c.Param("id"))
	if err != nil {
		httpx.HandleError(c, err, "read")
		return
	}
	if content.Redirect != "" {
		c.Redirect(http.StatusFound, content.Redirect)
		return
	}
	defer content.File.Close()
	c.DataFromReader(http.StatusOK, content.Size, content.Type, content.File, map[string]string{
		"Content-Disposition": content.Disposition,
		"Cache-Control":       "private, max-age=3600",
	})
}

// Receive handles PUT /api/files/:id/content: the bytes, for local storage.
func (f *Files) Receive(c *gin.Context) {
	record, err := files.Receive(c.Request.Context(), f.db, c.Param("id"), c.Request.Body)
	if err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
	httpx.OK(c, record)
}
`
  );
}
