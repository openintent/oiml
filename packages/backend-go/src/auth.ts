import type { IR, ProviderIR } from "@osl/core";
import { columnsConst, presentFunc, publicType, scanFunc, tableConst } from "./models.js";
import {
  HEADER,
  column,
  dbType,
  dbTypeImport,
  entityByName,
  exported,
  goFile,
  goStruct,
  isFile,
  keyedLiteral,
  q,
  quoteIdent,
  rowGoType,
  singlePrimaryKey,
  typeName
} from "./util.js";
import { fieldLiteral, objectLiteral } from "./validation.js";

/** Whether the model signs users in with magic links or OAuth */
export function hasProviders(ir: IR): boolean {
  return Boolean(ir.auth?.providers.some(p => p.kind !== "credentials"));
}

export function hasMagicLink(ir: IR): boolean {
  return Boolean(ir.auth?.providers.some(p => p.kind === "magic_link"));
}

export function oauthProviders(ir: IR): Extract<ProviderIR, { kind: "oauth" }>[] {
  return (ir.auth?.providers ?? []).filter((p): p is Extract<ProviderIR, { kind: "oauth" }> => p.kind === "oauth");
}

/** generated/auth/auth.go: sessions, passwords and the auth handlers. Without auth, a stub. */
export function authFile(ir: IR, modulePath: string): string {
  if (!ir.auth) {
    return goFile(
      modulePath,
      HEADER("Auth is not configured in the model; sessions are always empty."),
      "auth",
      ["github.com/gin-gonic/gin", "github.com/jackc/pgx/v5/pgxpool"],
      `// Session is never present: the model has no auth.
type Session struct{}

// UserID is nil: nobody is ever signed in.
func (s *Session) UserID() any {
	return nil
}

// Role is empty: nobody is ever signed in.
func (s *Session) Role() string {
	return ""
}

// Auth resolves sessions; without auth in the model there are none.
type Auth struct{}

// New builds the auth service.
func New(db *pgxpool.Pool) *Auth {
	return &Auth{}
}

// Session always reports no session.
func (a *Auth) Session(c *gin.Context) (*Session, error) {
	return nil, nil
}

// Routes registers nothing: the model has no auth endpoints.
func (a *Auth) Routes(r gin.IRouter) {
}
`
    );
  }

  const auth = ir.auth;
  const identity = entityByName(ir, auth.identity);
  const T = typeName(identity);
  const pk = column(identity, identity.primaryKey[0]);
  const pkType = rowGoType(pk);
  const pkField = exported(pk.name);
  const emailColumn = column(identity, auth.emailColumn);
  const roleColumn = identity.columns.find(c => c.name === "role");
  const credentials = auth.providers.some(p => p.kind === "credentials");
  const magic = hasMagicLink(ir);
  const oauth = oauthProviders(ir);
  const tenancy = auth.tenancy;
  const registerFiles = auth.registerFields.map(name => column(identity, name)).filter(isFile);
  const tableC = `models.${tableConst(identity)}`;
  const columnsC = `models.${columnsConst(identity)}`;
  const scan = `models.${scanFunc(identity)}`;
  const present = `models.${presentFunc(identity)}`;

  let roleBody = `\treturn ""`;
  if (roleColumn) {
    const field = `s.User.${exported(roleColumn.name)}`;
    const isString =
      roleColumn.type.kind === "enum" ||
      (roleColumn.type.kind === "scalar" && (roleColumn.type.scalar === "string" || roleColumn.type.scalar === "text"));
    if (roleColumn.nullable)
      roleBody = `\tif ${field} == nil {\n\t\treturn ""\n\t}\n\treturn ${isString ? `*${field}` : `fmt.Sprint(*${field})`}`;
    else roleBody = `\treturn ${isString ? field : `fmt.Sprint(${field})`}`;
  }

  const imports = new Set<string>([
    "context",
    "crypto/hmac",
    "crypto/sha256",
    "crypto/subtle",
    "encoding/base64",
    "encoding/json",
    "errors",
    "net/http",
    "os",
    "strconv",
    "strings",
    "time",
    "github.com/gin-gonic/gin",
    "github.com/jackc/pgx/v5",
    dbTypeImport(ir, modulePath),
    `${modulePath}/generated/httpx`,
    `${modulePath}/generated/models`
  ]);
  if (roleBody.includes("fmt.")) imports.add("fmt");
  // Under isolation: database the memberships come from a function (no tenant is bound yet), and binding them is what scopes the request
  const isolation = tenancy?.isolation;
  if (isolation) imports.add("fmt");
  if (credentials) {
    imports.add("crypto/rand");
    imports.add("golang.org/x/crypto/scrypt");
    imports.add(`${modulePath}/generated/db`);
    imports.add(`${modulePath}/generated/validation`);
    if (registerFiles.length) imports.add(`${modulePath}/generated/files`);
  }
  if (magic || oauth.length) imports.add(`${modulePath}/generated/db`);

  const sessionFields: { name: string; type: string }[] = [{ name: "User", type: `models.${publicType(identity)}` }];
  let membershipSection = "";
  let loadMemberships = "";
  if (tenancy) {
    const membership = entityByName(ir, tenancy.membership);
    const tenantType = rowGoType(singlePrimaryKey(entityByName(ir, tenancy.entity)));
    sessionFields.push({ name: "Memberships", type: "[]Membership" });
    membershipSection = `
${goStruct(
  "Membership",
  [
    { name: "Tenant", type: tenantType },
    { name: "Role", type: "string" }
  ],
  `Membership is one of the user's tenants (${tenancy.entity}) and the role they hold there.`
)}
`;
    const membershipsQuery = isolation
      ? `a.db.Query(ctx, \`SELECT tenant, role FROM ${quoteIdent(isolation.memberships)}($1) ORDER BY tenant\`, user.${pkField})`
      : `a.db.Query(ctx, \`SELECT ${quoteIdent(tenancy.tenantColumn)}, ${quoteIdent(tenancy.roleColumn)} FROM \`+models.${tableConst(membership)}+\` WHERE ${quoteIdent(tenancy.userColumn)} = $1 ORDER BY ${quoteIdent(tenancy.tenantColumn)}\`, user.${pkField})`;
    const bind = isolation
      ? `
	// The statements of this request reach the rows of these tenants, and no other tenant's
	tenants := make([]string, 0, len(session.Memberships))
	for _, m := range session.Memberships {
		tenants = append(tenants, fmt.Sprint(m.Tenant))
	}
	db.Bind(ctx, tenants)`
      : "";
    loadMemberships = `
	rows, err := ${membershipsQuery}
	if err != nil {
		return nil, err
	}
	memberships, err := models.Collect(rows, func(row models.Scanner) (*Membership, error) {
		var m Membership
		if err := row.Scan(&m.Tenant, &m.Role); err != nil {
			return nil, err
		}
		return &m, nil
	})
	if err != nil {
		return nil, err
	}
	session.Memberships = make([]Membership, 0, len(memberships))
	for _, m := range memberships {
		session.Memberships = append(session.Memberships, *m)
	}${bind}`;
  }

  const routes: string[] = [];
  if (credentials) routes.push(`\tr.POST("/api/auth/register", a.Register)`, `\tr.POST("/api/auth/login", a.Login)`);
  if (magic)
    routes.push(
      `\tr.POST("/api/auth/magic-link", a.MagicLink)`,
      `\tr.POST("/api/auth/magic-link/verify", a.MagicLinkVerify)`
    );
  if (oauth.length)
    routes.push(
      `\tr.GET("/api/auth/oauth/:name", a.OAuthStart)`,
      `\tr.GET("/api/auth/oauth/:name/callback", a.OAuthCallback)`
    );
  routes.push(
    `\tr.POST("/api/auth/logout", a.Logout)`,
    `\tr.GET("/api/auth/me", a.Me)`,
    `\tr.GET("/api/auth/providers", a.Providers)`
  );

  const providerList = auth.providers.map(
    p => `{Kind: ${q(p.kind)}, Name: ${q(p.kind === "oauth" ? p.name : p.kind)}}`
  );

  const sections: string[] = [];
  sections.push(`const cookieName = "osl_session"

const sessionDays = ${auth.sessionDays}

const sessionMaxAge = sessionDays * 86400

const sessionMaxAgeMillis = int64(sessionDays) * 86400000

const defaultSecret = "osl-dev-secret-change-me"

// registerable is whether a magic link or an OAuth profile may create a ${T}: the identity needs nothing but an email and a name.
const registerable = ${auth.registerable}
${membershipSection}
${goStruct("Session", sessionFields, "Session is the signed-in user" + (tenancy ? " and their memberships." : "."))}

// UserID is the id of the signed-in user.
func (s *Session) UserID() any {
	return s.User.${pkField}
}

// Role is the role of the signed-in user, or "" when the model has none.
func (s *Session) Role() string {
${roleBody}
}

// Provider is one way to sign in, as GET /api/auth/providers lists them.
type Provider struct {
	Kind string \`json:"kind"\`
	Name string \`json:"name"\`
}

// Providers lists the model's sign-in providers in declared order.
var Providers = []Provider{${providerList.join(", ")}}

// Auth serves the auth endpoints and resolves sessions.
type Auth struct {
	db ${dbType(ir)}
}

// New builds the auth service.
func New(db ${dbType(ir)}) *Auth {
	return &Auth{db: db}
}

// Routes registers the auth endpoints.
func (a *Auth) Routes(r gin.IRouter) {
${routes.join("\n")}
}

// AppURL is where the web app lives (OSL_APP_URL, default http://localhost:3000): magic links point there and OAuth returns there.
func AppURL() string {
	if v := os.Getenv("OSL_APP_URL"); v != "" {
		return strings.TrimSuffix(v, "/")
	}
	return "http://localhost:3000"
}

func secret() []byte {
	if s := os.Getenv("OSL_SESSION_SECRET"); s != "" {
		return []byte(s)
	}
	return []byte(defaultSecret)
}`);

  if (credentials) {
    sections.push(`// HashPassword derives scrypt$<salt>$<hash>, both base64url, with scrypt N=16384 r=8 p=1 and a 64-byte key.
func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	encodedSalt := base64.RawURLEncoding.EncodeToString(salt)
	hash, err := scrypt.Key([]byte(password), []byte(encodedSalt), 16384, 8, 1, 64)
	if err != nil {
		return "", err
	}
	return "scrypt$" + encodedSalt + "$" + base64.RawURLEncoding.EncodeToString(hash), nil
}

// VerifyPassword checks a password against a stored hash in constant time.
func VerifyPassword(password string, stored *string) bool {
	if stored == nil {
		return false
	}
	parts := strings.Split(*stored, "$")
	if len(parts) != 3 || parts[0] != "scrypt" || parts[1] == "" || parts[2] == "" {
		return false
	}
	expected, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	candidate, err := scrypt.Key([]byte(password), []byte(parts[1]), 16384, 8, 1, 64)
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(candidate, expected) == 1
}`);
  }

  sections.push(`${goStruct("sessionPayload", [
    { name: "UID", type: pkType, tag: '`json:"uid"`' },
    { name: "Exp", type: "int64", tag: '`json:"exp"`' }
  ])}

func sign(payload string) string {
	mac := hmac.New(sha256.New, secret())
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func sessionCookie(userID ${pkType}) string {
	exp := time.Now().UnixMilli() + sessionMaxAgeMillis
	data, err := json.Marshal(sessionPayload{UID: userID, Exp: exp})
	if err != nil {
		panic(err)
	}
	payload := base64.RawURLEncoding.EncodeToString(data)
	return cookieName + "=" + payload + "." + sign(payload) + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + strconv.Itoa(sessionMaxAge)
}

func clearedCookie() string {
	return cookieName + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
}

func readCookie(c *gin.Context) (*sessionPayload, bool) {
	cookie, err := c.Request.Cookie(cookieName)
	if err != nil {
		return nil, false
	}
	payload, signature, found := strings.Cut(cookie.Value, ".")
	if !found || payload == "" || signature == "" {
		return nil, false
	}
	if subtle.ConstantTimeCompare([]byte(sign(payload)), []byte(signature)) != 1 {
		return nil, false
	}
	data, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return nil, false
	}
	var parsed sessionPayload
	if err := json.Unmarshal(data, &parsed); err != nil || parsed.Exp < time.Now().UnixMilli() {
		return nil, false
	}
	return &parsed, true
}

// signIn sets the session cookie for a user.
func signIn(c *gin.Context, user *models.${T}) {
	c.Writer.Header().Add("Set-Cookie", sessionCookie(user.${pkField}))
}

// SessionOf builds the session of a user row${tenancy ? ", loading their memberships" : ""}.
func (a *Auth) SessionOf(ctx context.Context, user *models.${T}) (*Session, error) {
	session := &Session{User: ${present}(user)}${loadMemberships}
	return session, nil
}

// Session resolves the signed-in user, loading it so a deleted account signs out at once.
func (a *Auth) Session(c *gin.Context) (*Session, error) {
	payload, ok := readCookie(c)
	if !ok {
		return nil, nil
	}
	ctx := c.Request.Context()
	user, err := ${scan}(a.db.QueryRow(ctx, \`SELECT \`+${columnsC}+\` FROM \`+${tableC}+\` WHERE ${quoteIdent(pk.name)} = $1\`, payload.UID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return a.SessionOf(ctx, user)
}`);

  if (credentials) {
    const registerFields = [
      fieldLiteral(ir, emailColumn, "create"),
      `{Name: "password", Required: true, Type: validation.String{MinLength: 8, MaxLength: 200}}`,
      ...auth.registerFields.map(name => fieldLiteral(ir, column(identity, name), "create"))
    ];
    const loginFields = [
      `{Name: ${q(auth.emailColumn)}, Required: true, Type: validation.String{}}`,
      `{Name: "password", Required: true, Type: validation.String{}}`
    ];
    const resolveFiles = registerFiles.length
      ? `\tif err := files.ResolveRefs(c.Request.Context(), a.db, values, registerFileFields); err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
`
      : "";
    const fileSpecs = registerFiles.length
      ? `

// registerFileFields lists the file fields register accepts and what they allow.
var registerFileFields = ${fileSpecsLiteral(registerFiles)}`
      : "";
    sections.push(`var registerInput = ${objectLiteral(registerFields)}

var loginInput = ${objectLiteral(loginFields)}${fileSpecs}

// Register creates a ${T} and signs it in.
func (a *Auth) Register(c *gin.Context) {
	body, perr := httpx.ParseBody(c)
	if perr != nil {
		httpx.Fail(c, perr)
		return
	}
	values, perr := registerInput.Parse(body)
	if perr != nil {
		httpx.Fail(c, perr)
		return
	}
${resolveFiles}	hash, err := HashPassword(values["password"].(string))
	if err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
	delete(values, "password")
	values[${q(auth.passwordColumn)}] = hash
	sql, args := db.Insert(${tableC}, values, ${columnsC})
	user, err := ${scan}(a.db.QueryRow(c.Request.Context(), sql, args...))
	if err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
	signIn(c, user)
	httpx.Created(c, ${present}(user))
}

// Login checks the credentials and signs the ${T} in.
func (a *Auth) Login(c *gin.Context) {
	body, perr := httpx.ParseBody(c)
	if perr != nil {
		httpx.Fail(c, perr)
		return
	}
	values, perr := loginInput.Parse(body)
	if perr != nil {
		httpx.Fail(c, perr)
		return
	}
	user, err := ${scan}(a.db.QueryRow(c.Request.Context(), \`SELECT \`+${columnsC}+\` FROM \`+${tableC}+\` WHERE ${quoteIdent(auth.emailColumn)} = $1\`, values[${q(auth.emailColumn)}]))
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		httpx.HandleError(c, err, "read")
		return
	}
	if user == nil || !VerifyPassword(values["password"].(string), user.${exported(auth.passwordColumn)}) {
		httpx.Fail(c, httpx.NewError(http.StatusUnauthorized, "invalid_credentials", "Email or password is wrong"))
		return
	}
	signIn(c, user)
	httpx.OK(c, ${present}(user))
}`);
  }

  sections.push(`// Logout clears the session cookie.
func (a *Auth) Logout(c *gin.Context) {
	c.Writer.Header().Add("Set-Cookie", clearedCookie())
	httpx.NoContent(c)
}

// Me returns the signed-in ${T}.
func (a *Auth) Me(c *gin.Context) {
	session, err := a.Session(c)
	if err != nil {
		httpx.HandleError(c, err, "read")
		return
	}
	if session == nil {
		httpx.Fail(c, httpx.NewError(http.StatusUnauthorized, "unauthenticated", "Sign in to continue"))
		return
	}
	httpx.OK(c, session.User)
}

// Providers lists how users may sign in, for the sign-in page.
func (a *Auth) Providers(c *gin.Context) {
	httpx.OK(c, Providers)
}`);

  if (magic || oauth.length) {
    const nameValue = auth.nameColumn
      ? `
	if name == "" {
		name, _, _ = strings.Cut(address, "@")
	}
	values[${q(auth.nameColumn)}] = name`
      : `
	_ = name`;
    const create = auth.registerable
      ? `	values := models.Values{${q(auth.emailColumn)}: address}${nameValue}
	sql, args := db.Insert(${tableC}, values, ${columnsC})
	return ${scan}(a.db.QueryRow(ctx, sql, args...))`
      : `	_ = name
	return nil, httpx.NewError(http.StatusForbidden, "registration_closed", "No account for "+address+"; register first")`;
    sections.push(`// findOrCreateByEmail answers the ${T} with this email, creating one when registerable (name fills the name column, falling back to the email's local part).
func (a *Auth) findOrCreateByEmail(ctx context.Context, rawEmail string, name string) (*models.${T}, error) {
	address := strings.ToLower(strings.TrimSpace(rawEmail))
	user, err := ${scan}(a.db.QueryRow(ctx, \`SELECT \`+${columnsC}+\` FROM \`+${tableC}+\` WHERE ${quoteIdent(auth.emailColumn)} = $1\`, address))
	if err == nil {
		return user, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
${create}
}`);
  }

  return goFile(
    modulePath,
    HEADER("Auth: cookie sessions and the auth handlers (passwords, sign-out, me, providers)."),
    "auth",
    imports,
    sections.join("\n\n")
  );
}

/** The file-field specs of columns as a Go literal of files.FieldSpec */
export function fileSpecsLiteral(
  columns: { name: string; type: { kind: string; accept?: string[]; maxSize?: number } }[]
): string {
  const specs = columns.map(c => {
    const t = c.type as { kind: "file"; accept?: string[]; maxSize?: number };
    const parts = [`Column: ${q(c.name)}`];
    if (t.accept) parts.push(`Accept: []string{${t.accept.map(q).join(", ")}}`);
    if (t.maxSize) parts.push(`MaxSize: ${t.maxSize}`);
    return `{${parts.join(", ")}}`;
  });
  return `[]files.FieldSpec{${specs.join(", ")}}`;
}

/** generated/auth/providers.go: magic links and OAuth. Only when the model has such providers. */
export function authProvidersFile(ir: IR, modulePath: string): string {
  const auth = ir.auth!;
  const identity = entityByName(ir, auth.identity);
  const T = typeName(identity);
  const pk = column(identity, identity.primaryKey[0]);
  const magic = hasMagicLink(ir);
  const oauth = oauthProviders(ir);
  const tableC = `models.${tableConst(identity)}`;
  const columnsC = `models.${columnsConst(identity)}`;
  const scan = `models.${scanFunc(identity)}`;
  const present = `models.${presentFunc(identity)}`;
  const imports = new Set<string>([
    "crypto/rand",
    "crypto/sha256",
    "encoding/base64",
    "errors",
    "net/http",
    "time",
    "github.com/gin-gonic/gin",
    "github.com/jackc/pgx/v5",
    `${modulePath}/generated/httpx`,
    `${modulePath}/generated/models`
  ]);
  const sections: string[] = [];
  sections.push(`const magicLinkMinutes = 10

const oauthStateMinutes = 10

// randomToken is n random bytes as base64url.
func randomToken(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

// hashToken is the sha256 of a token as base64url: what the database stores, and the PKCE challenge of a verifier.
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}`);

  if (magic) {
    const tokens = entityByName(ir, "OslAuthToken");
    imports.add("net/url");
    imports.add("strings");
    imports.add(`${modulePath}/generated/email`);
    imports.add(`${modulePath}/generated/validation`);
    sections.push(`var magicLinkInput = validation.Object{Fields: []validation.Field{
	{Name: "email", Required: true, Type: validation.String{MaxLength: 255, Format: "email"}},
}}

var magicLinkVerifyInput = validation.Object{Fields: []validation.Field{
	{Name: "token", Required: true, Type: validation.String{MinLength: 1}},
}}

type magicLinkDebug struct {
	Token string \`json:"token"\`
	URL   string \`json:"url"\`
}

type magicLinkReply struct {
	Sent  bool            \`json:"sent"\`
	Debug *magicLinkDebug \`json:"debug,omitempty"\`
}

// MagicLink handles POST /api/auth/magic-link: emails a one-time sign-in link. It always answers sent so
// addresses cannot be probed; when emails are captured (tests) the reply also carries the token.
func (a *Auth) MagicLink(c *gin.Context) {
	body, perr := httpx.ParseBody(c)
	if perr != nil {
		httpx.Fail(c, perr)
		return
	}
	values, perr := magicLinkInput.Parse(body)
	if perr != nil {
		httpx.Fail(c, perr)
		return
	}
	ctx := c.Request.Context()
	address := strings.ToLower(strings.TrimSpace(values["email"].(string)))
	var exists bool
	if err := a.db.QueryRow(ctx, \`SELECT EXISTS (SELECT 1 FROM \`+${tableC}+\` WHERE ${quoteIdent(auth.emailColumn)} = $1)\`, address).Scan(&exists); err != nil {
		httpx.HandleError(c, err, "read")
		return
	}
	if !exists && !registerable {
		httpx.OK(c, magicLinkReply{Sent: true})
		return
	}
	token := randomToken(32)
	expires := time.Now().Add(magicLinkMinutes * time.Minute)
	if _, err := a.db.Exec(ctx, \`INSERT INTO \`+models.${tableConst(tokens)}+\` ("token_hash", "email", "purpose", "expires_at") VALUES ($1, $2, 'magic_link', $3)\`, hashToken(token), address, expires); err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
	link := AppURL() + "/login/verify?token=" + url.QueryEscape(token)
	err := email.Send(ctx, email.Email{
		To:      address,
		Subject: "Your sign-in link",
		Text:    "Sign in with this link (valid for " + strconv.Itoa(magicLinkMinutes) + " minutes): " + link,
	})
	if err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
	if email.CurrentMode() == email.ModeCapture {
		httpx.OK(c, magicLinkReply{Sent: true, Debug: &magicLinkDebug{Token: token, URL: link}})
		return
	}
	httpx.OK(c, magicLinkReply{Sent: true})
}

// MagicLinkVerify handles POST /api/auth/magic-link/verify: takes the token (once) and signs its user in.
func (a *Auth) MagicLinkVerify(c *gin.Context) {
	body, perr := httpx.ParseBody(c)
	if perr != nil {
		httpx.Fail(c, perr)
		return
	}
	values, perr := magicLinkVerifyInput.Parse(body)
	if perr != nil {
		httpx.Fail(c, perr)
		return
	}
	ctx := c.Request.Context()
	row, err := models.${scanFunc(tokens)}(a.db.QueryRow(ctx, \`DELETE FROM \`+models.${tableConst(tokens)}+\` WHERE "token_hash" = $1 RETURNING \`+models.${columnsConst(tokens)}, hashToken(values["token"].(string))))
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		httpx.HandleError(c, err, "write")
		return
	}
	if row == nil || row.Purpose != "magic_link" || row.ExpiresAt.Before(time.Now()) {
		httpx.Fail(c, httpx.NewError(http.StatusBadRequest, "invalid_token", "This link is invalid or has expired"))
		return
	}
	user, err := a.findOrCreateByEmail(ctx, row.Email, "")
	if err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
	signIn(c, user)
	httpx.OK(c, ${present}(user))
}`);
    imports.add("strconv");
  }

  if (oauth.length) {
    const states = entityByName(ir, "OslAuthState");
    const accounts = entityByName(ir, "OslAuthAccount");
    imports.add("context");
    imports.add("encoding/json");
    imports.add("io");
    imports.add("net/url");
    imports.add("os");
    imports.add("strconv");
    imports.add("strings");
    imports.add("sync");
    const presets = oauth.map(p => {
      const env = p.name.toUpperCase().replace(/-/g, "_");
      const config =
        p.provider === "github"
          ? `Kind: "github", Authorize: "https://github.com/login/oauth/authorize", Token: "https://github.com/login/oauth/access_token", Scope: "read:user user:email"`
          : p.provider === "google"
            ? `Kind: "oidc", Issuer: "https://accounts.google.com", Scope: "openid email profile", PKCE: true`
            : `Kind: "oidc", Issuer: ${q(p.issuer!)}, Scope: "openid email profile", PKCE: true`;
      return [
        q(p.name),
        `{${config}, ClientID: os.Getenv("OAUTH_${env}_CLIENT_ID"), ClientSecret: os.Getenv("OAUTH_${env}_CLIENT_SECRET")}`
      ] as [string, string];
    });
    sections.push(`// oauthProvider is one configured OAuth provider: GitHub's fixed endpoints, or an OpenID Connect issuer discovered at runtime.
type oauthProvider struct {
	Kind         string
	Authorize    string
	Token        string
	Issuer       string
	Scope        string
	PKCE         bool
	ClientID     string
	ClientSecret string
}

var oauthProviderConfigs = ${keyedLiteral("map[string]oauthProvider", presets)}

type oidcDocument struct {
	AuthorizationEndpoint string \`json:"authorization_endpoint"\`
	TokenEndpoint         string \`json:"token_endpoint"\`
	UserinfoEndpoint      string \`json:"userinfo_endpoint"\`
}

var discovered = struct {
	sync.Mutex
	docs map[string]*oidcDocument
}{docs: map[string]*oidcDocument{}}

// discover reads an issuer's OpenID configuration once.
func discover(ctx context.Context, issuer string) (*oidcDocument, error) {
	discovered.Lock()
	defer discovered.Unlock()
	if doc, ok := discovered.docs[issuer]; ok {
		return doc, nil
	}
	var doc oidcDocument
	if err := getJSON(ctx, strings.TrimSuffix(issuer, "/")+"/.well-known/openid-configuration", "", &doc); err != nil {
		return nil, errors.New("OIDC discovery failed for " + issuer + ": " + err.Error())
	}
	discovered.docs[issuer] = &doc
	return &doc, nil
}

func getJSON(ctx context.Context, target string, bearer string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "osl")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	if res.StatusCode >= 300 {
		return errors.New("status " + strconv.Itoa(res.StatusCode))
	}
	return json.Unmarshal(data, out)
}

func oauthProviderOrFail(name string) (oauthProvider, *httpx.Error) {
	provider, ok := oauthProviderConfigs[name]
	if !ok {
		return provider, httpx.NotFound()
	}
	if provider.ClientID == "" || provider.ClientSecret == "" {
		env := strings.ToUpper(strings.ReplaceAll(name, "-", "_"))
		return provider, httpx.NewError(http.StatusBadRequest, "provider_unconfigured", "Set OAUTH_"+env+"_CLIENT_ID and _CLIENT_SECRET")
	}
	return provider, nil
}

func oauthRedirectURI(name string) string {
	return AppURL() + "/api/auth/oauth/" + name + "/callback"
}

// OAuthStart handles GET /api/auth/oauth/:name: records the pending authorisation and sends the browser to the provider.
func (a *Auth) OAuthStart(c *gin.Context) {
	name := c.Param("name")
	provider, perr := oauthProviderOrFail(name)
	if perr != nil {
		httpx.Fail(c, perr)
		return
	}
	ctx := c.Request.Context()
	redirectTo := c.Query("redirect")
	if redirectTo == "" {
		redirectTo = "/"
	}
	state := randomToken(24)
	var verifier, nonce *string
	if provider.PKCE {
		v := randomToken(32)
		verifier = &v
	}
	if provider.Kind == "oidc" {
		n := randomToken(16)
		nonce = &n
	}
	expires := time.Now().Add(oauthStateMinutes * time.Minute)
	if _, err := a.db.Exec(ctx, \`INSERT INTO \`+models.${tableConst(states)}+\` ("state_hash", "provider", "code_verifier", "nonce", "redirect_to", "expires_at") VALUES ($1, $2, $3, $4, $5, $6)\`, hashToken(state), name, verifier, nonce, redirectTo, expires); err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
	params := url.Values{}
	params.Set("client_id", provider.ClientID)
	params.Set("redirect_uri", oauthRedirectURI(name))
	params.Set("scope", provider.Scope)
	params.Set("state", state)
	params.Set("response_type", "code")
	if verifier != nil {
		params.Set("code_challenge", hashToken(*verifier))
		params.Set("code_challenge_method", "S256")
	}
	if nonce != nil {
		params.Set("nonce", *nonce)
	}
	endpoint := provider.Authorize
	if provider.Kind == "oidc" {
		doc, err := discover(ctx, provider.Issuer)
		if err != nil {
			httpx.HandleError(c, err, "write")
			return
		}
		endpoint = doc.AuthorizationEndpoint
	}
	c.Redirect(http.StatusFound, endpoint+"?"+params.Encode())
}

type oauthTokens struct {
	AccessToken string \`json:"access_token"\`
	IDToken     string \`json:"id_token"\`
}

type oauthProfile struct {
	ID    string
	Email string
	Name  string
}

// OAuthCallback handles GET /api/auth/oauth/:name/callback: checks the state, exchanges the code, reads the
// profile, links or creates the user, signs them in and sends the browser back to the app.
func (a *Auth) OAuthCallback(c *gin.Context) {
	name := c.Param("name")
	provider, perr := oauthProviderOrFail(name)
	if perr != nil {
		httpx.Fail(c, perr)
		return
	}
	if denied := c.Query("error"); denied != "" {
		message := c.Query("error_description")
		if message == "" {
			message = denied
		}
		httpx.Fail(c, httpx.NewError(http.StatusBadRequest, "oauth_denied", message))
		return
	}
	code, state := c.Query("code"), c.Query("state")
	if code == "" || state == "" {
		httpx.Fail(c, httpx.NewError(http.StatusBadRequest, "oauth_invalid", "Missing code or state"))
		return
	}
	ctx := c.Request.Context()
	pending, err := models.${scanFunc(states)}(a.db.QueryRow(ctx, \`DELETE FROM \`+models.${tableConst(states)}+\` WHERE "state_hash" = $1 AND "provider" = $2 AND "expires_at" > now() RETURNING \`+models.${columnsConst(states)}, hashToken(state), name))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Fail(c, httpx.NewError(http.StatusBadRequest, "oauth_invalid", "This sign-in attempt is unknown or has expired"))
			return
		}
		httpx.HandleError(c, err, "write")
		return
	}
	tokenEndpoint := provider.Token
	if provider.Kind == "oidc" {
		doc, err := discover(ctx, provider.Issuer)
		if err != nil {
			httpx.HandleError(c, err, "write")
			return
		}
		tokenEndpoint = doc.TokenEndpoint
	}
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", oauthRedirectURI(name))
	form.Set("client_id", provider.ClientID)
	form.Set("client_secret", provider.ClientSecret)
	if pending.CodeVerifier != nil {
		form.Set("code_verifier", *pending.CodeVerifier)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
	defer res.Body.Close()
	var tokens oauthTokens
	if res.StatusCode >= 300 || json.NewDecoder(res.Body).Decode(&tokens) != nil {
		httpx.Fail(c, httpx.NewError(http.StatusBadRequest, "oauth_exchange_failed", "The provider refused the code"))
		return
	}
	if tokens.AccessToken == "" {
		httpx.Fail(c, httpx.NewError(http.StatusBadRequest, "oauth_exchange_failed", "The provider sent no access token"))
		return
	}
	profile, perr := fetchProfile(ctx, provider, tokens, pending.Nonce)
	if perr != nil {
		httpx.Fail(c, perr)
		return
	}
	var user *models.${T}
	var linked ${rowGoType(pk)}
	err = a.db.QueryRow(ctx, \`SELECT "user_id" FROM \`+models.${tableConst(accounts)}+\` WHERE "provider" = $1 AND "provider_account_id" = $2\`, name, profile.ID).Scan(&linked)
	switch {
	case err == nil:
		user, err = ${scan}(a.db.QueryRow(ctx, \`SELECT \`+${columnsC}+\` FROM \`+${tableC}+\` WHERE ${quoteIdent(pk.name)} = $1\`, linked))
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Fail(c, httpx.NewError(http.StatusBadRequest, "oauth_invalid", "The linked account no longer exists"))
			return
		}
		if err != nil {
			httpx.HandleError(c, err, "write")
			return
		}
	case errors.Is(err, pgx.ErrNoRows):
		if profile.Email == "" {
			httpx.Fail(c, httpx.NewError(http.StatusBadRequest, "oauth_no_email", "The provider shared no verified email address"))
			return
		}
		user, err = a.findOrCreateByEmail(ctx, profile.Email, profile.Name)
		if err != nil {
			httpx.HandleError(c, err, "write")
			return
		}
		if _, err := a.db.Exec(ctx, \`INSERT INTO \`+models.${tableConst(accounts)}+\` ("provider", "provider_account_id", "user_id") VALUES ($1, $2, $3)\`, name, profile.ID, user.${exported(pk.name)}); err != nil {
			httpx.HandleError(c, err, "write")
			return
		}
	default:
		httpx.HandleError(c, err, "write")
		return
	}
	signIn(c, user)
	redirectTo := "/"
	if pending.RedirectTo != nil {
		redirectTo = *pending.RedirectTo
	}
	c.Redirect(http.StatusFound, AppURL()+redirectTo)
}

type githubUser struct {
	ID    int64   \`json:"id"\`
	Email *string \`json:"email"\`
	Name  *string \`json:"name"\`
	Login string  \`json:"login"\`
}

type githubEmail struct {
	Email    string \`json:"email"\`
	Primary  bool   \`json:"primary"\`
	Verified bool   \`json:"verified"\`
}

type oidcClaims struct {
	Sub           string \`json:"sub"\`
	Email         string \`json:"email"\`
	EmailVerified *bool  \`json:"email_verified"\`
	Name          string \`json:"name"\`
	Nonce         string \`json:"nonce"\`
}

func (claims oidcClaims) profile() oauthProfile {
	email := claims.Email
	if claims.EmailVerified != nil && !*claims.EmailVerified {
		email = ""
	}
	return oauthProfile{ID: claims.Sub, Email: email, Name: claims.Name}
}

// fetchProfile reads who signed in: GitHub's user and verified emails, or the OIDC identity token (checked
// against the nonce) falling back to the userinfo endpoint.
func fetchProfile(ctx context.Context, provider oauthProvider, tokens oauthTokens, nonce *string) (oauthProfile, *httpx.Error) {
	if provider.Kind == "github" {
		var user githubUser
		if err := getJSON(ctx, "https://api.github.com/user", tokens.AccessToken, &user); err != nil {
			return oauthProfile{}, httpx.NewError(http.StatusBadRequest, "oauth_invalid", "The provider shared no identity")
		}
		profile := oauthProfile{ID: strconv.FormatInt(user.ID, 10), Name: user.Login}
		if user.Name != nil {
			profile.Name = *user.Name
		}
		if user.Email != nil {
			profile.Email = *user.Email
			return profile, nil
		}
		var emails []githubEmail
		if err := getJSON(ctx, "https://api.github.com/user/emails", tokens.AccessToken, &emails); err == nil {
			for _, e := range emails {
				if e.Primary && e.Verified {
					profile.Email = e.Email
					return profile, nil
				}
			}
			for _, e := range emails {
				if e.Verified {
					profile.Email = e.Email
					return profile, nil
				}
			}
		}
		return profile, nil
	}
	if tokens.IDToken != "" {
		parts := strings.Split(tokens.IDToken, ".")
		if len(parts) < 2 {
			return oauthProfile{}, httpx.NewError(http.StatusBadRequest, "oauth_invalid", "The identity token is malformed")
		}
		payload, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[1], "="))
		var claims oidcClaims
		if err != nil || json.Unmarshal(payload, &claims) != nil {
			return oauthProfile{}, httpx.NewError(http.StatusBadRequest, "oauth_invalid", "The identity token is malformed")
		}
		if nonce != nil && claims.Nonce != *nonce {
			return oauthProfile{}, httpx.NewError(http.StatusBadRequest, "oauth_invalid", "The identity token does not match this sign-in")
		}
		return claims.profile(), nil
	}
	doc, err := discover(ctx, provider.Issuer)
	if err != nil || doc.UserinfoEndpoint == "" {
		return oauthProfile{}, httpx.NewError(http.StatusBadRequest, "oauth_invalid", "The provider shared no identity")
	}
	var claims oidcClaims
	if err := getJSON(ctx, doc.UserinfoEndpoint, tokens.AccessToken, &claims); err != nil {
		return oauthProfile{}, httpx.NewError(http.StatusBadRequest, "oauth_invalid", "The provider shared no identity")
	}
	return claims.profile(), nil
}`);
  }

  return goFile(
    modulePath,
    HEADER("Sign-in providers beyond passwords: magic links and OAuth."),
    "auth",
    imports,
    sections.join("\n\n")
  );
}
