import type { EntityIR, IR } from "@osl/core";
import { SEAL_KEY_ENV, SEAL_KEY_HINT, SEAL_VECTORS, hasSealed, sealedColumns, sealedNames } from "@osl/core";
import { HEADER, exported, goFile, q } from "./util.js";

/** `seal.IntegrationsSecret`: the constant naming a sealed column, as code outside the package spells it */
export function sealConst(entity: EntityIR, column: string): string {
  return `seal.${exported(entity.table)}${exported(column)}`;
}

/**
 * generated/seal/seal.go: the sealed fields' format and key. The same bytes the TypeScript backends write and read
 * (`@osl/core`'s seal.ts is the reference, with the vectors the generated test repeats).
 */
export function sealFile(ir: IR, modulePath: string): string {
  const names = sealedNames(ir);
  const named = ir.entities.flatMap(e =>
    sealedColumns(e).map(c => ({ ident: `${exported(e.table)}${exported(c.name)}`, name: `${e.table}.${c.name}` }))
  );
  // gofmt lines the values of a constant block up
  const width = Math.max(...named.map(n => n.ident.length));
  const constants = named.map(n => `\t${n.ident.padEnd(width)} = ${q(n.name)}`);
  const what = `${names.join(", ")} ${names.length === 1 ? "is" : "are"} sealed, and the app does not run without the key ${names.length === 1 ? "it is" : "they are"} encrypted under (${SEAL_KEY_HINT})`;
  return goFile(
    modulePath,
    HEADER("Sealed fields: encrypted at rest with AES-256-GCM under OSL_SEAL_KEY, opened only where the code asks."),
    "seal",
    ["crypto/aes", "crypto/cipher", "crypto/rand", "encoding/hex", "fmt", "os", "sync"],
    `// A sealed value as its column stores it:
//
//	version (1 byte, 0x01) || nonce (12 random bytes) || ciphertext || tag (16 bytes)
//
// The associated data is the version byte followed by "<table>.<column>" in UTF-8, so a value copied into
// another column or table does not open there. Every OSL backend writes and reads these bytes, so a database
// moves between them with its key.
const (
	version    = 1
	nonceBytes = 12
	tagBytes   = 16
)

// The sealed fields, by the name their values are bound to.
const (
${constants.join("\n")}
)

// Error is a refusal of the seal: no key, a key that is not one, or a stored value that does not open. Its
// message never holds a value.
type Error struct {
	message string
}

func (e *Error) Error() string {
	return e.message
}

var (
	key     []byte
	keyErr  error
	keyOnce sync.Once
)

// Load reads the key from ${SEAL_KEY_ENV}, once. Without one, or with one that is not 32 bytes in hexadecimal, it
// answers an error: the app calls it as it starts and does not start, and nothing is ever sealed under a
// makeshift key.
func Load() error {
	keyOnce.Do(func() {
		raw := os.Getenv(${q(SEAL_KEY_ENV)})
		problem := ""
		switch {
		case raw == "":
			problem = "${SEAL_KEY_ENV} is not set"
		case !isHex(raw):
			problem = "${SEAL_KEY_ENV} is not hexadecimal"
		case len(raw) != 64:
			problem = fmt.Sprintf("${SEAL_KEY_ENV} has %d hexadecimal characters, not 64", len(raw))
		}
		if problem != "" {
			keyErr = &Error{message: problem + ${q(`: ${what}`)}}
			return
		}
		key, keyErr = hex.DecodeString(raw)
	})
	return keyErr
}

func isHex(s string) bool {
	for _, r := range s {
		if !(r >= '0' && r <= '9' || r >= 'a' && r <= 'f' || r >= 'A' && r <= 'F') {
			return false
		}
	}
	return true
}

func loaded() []byte {
	if err := Load(); err != nil {
		panic(err)
	}
	return key
}

func gcm(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func associated(field string) []byte {
	return append([]byte{version}, field...)
}

// SealWith seals under a given key. nonce is for the fixed vectors of the format: every real write takes a
// fresh random one (pass nil).
func SealWith(key []byte, field string, plaintext string, nonce []byte) ([]byte, error) {
	aead, err := gcm(key)
	if err != nil {
		return nil, err
	}
	if nonce == nil {
		nonce = make([]byte, nonceBytes)
		if _, err := rand.Read(nonce); err != nil {
			return nil, err
		}
	}
	if len(nonce) != nonceBytes {
		return nil, &Error{message: field + ": a nonce is 12 bytes"}
	}
	out := make([]byte, 0, 1+nonceBytes+len(plaintext)+tagBytes)
	out = append(out, version)
	out = append(out, nonce...)
	return aead.Seal(out, nonce, []byte(plaintext), associated(field)), nil
}

// OpenWith opens a stored value under a given key.
func OpenWith(key []byte, field string, stored []byte) (string, error) {
	if len(stored) < 1+nonceBytes+tagBytes {
		return "", &Error{message: field + ": the stored value is too short to be sealed"}
	}
	if stored[0] != version {
		return "", &Error{message: fmt.Sprintf("%s: sealed with layout version %d, which this build does not read", field, stored[0])}
	}
	aead, err := gcm(key)
	if err != nil {
		return "", err
	}
	plain, err := aead.Open(nil, stored[1:1+nonceBytes], stored[1+nonceBytes:], associated(field))
	if err != nil {
		return "", &Error{message: field + ": a sealed value did not open: ${SEAL_KEY_ENV} is not the key it was sealed under, or the value was copied from another column"}
	}
	return string(plain), nil
}

// Seal is a value as its column stores it. Your own code calls it wherever it writes a sealed column.
func Seal(field string, plaintext string) []byte {
	out, err := SealWith(loaded(), field, plaintext, nil)
	if err != nil {
		panic(err)
	}
	return out
}

// Open is what a stored value says. Your own code calls it to read a sealed column of a row it loaded; the API
// itself opens a value only in the presenter, for a caller the field's read rule allows. It answers an *Error
// when the value does not open: never a guess, never an empty answer.
func Open(field string, stored []byte) (string, error) {
	return OpenWith(loaded(), field, stored)
}

// MustOpen opens a value the presenter is about to answer. A value that does not open ends the request: the
// recovery answers 500 and logs the column, never the value.
func MustOpen(field string, stored []byte) string {
	plain, err := Open(field, stored)
	if err != nil {
		panic(err)
	}
	return plain
}

// MustOpenPtr opens an optional value; a NULL column stays nil.
func MustOpenPtr(field string, stored []byte) *string {
	if stored == nil {
		return nil
	}
	plain := MustOpen(field, stored)
	return &plain
}
`
  );
}

/** generated/seal/seal_test.go: the fixed vectors of the format, which every backend's tests repeat */
export function sealTestFile(modulePath: string): string {
  const vectors = SEAL_VECTORS.map(
    v => `\t{${q(v.key)}, ${q(v.name)}, ${q(v.nonce)}, ${q(v.plaintext)}, ${q(v.sealed)}},`
  ).join("\n");
  return goFile(
    modulePath,
    HEADER("The sealed fields' format, held to its fixed vectors: the bytes every OSL backend stores and opens."),
    "seal",
    ["bytes", "encoding/hex", "errors", "strings", "testing"],
    `var vectors = []struct{ key, name, nonce, plaintext, sealed string }{
${vectors}
}

func unhex(t *testing.T, text string) []byte {
	t.Helper()
	out, err := hex.DecodeString(text)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestStoresTheBytesTheFormatFixes(t *testing.T) {
	for _, v := range vectors {
		sealed, err := SealWith(unhex(t, v.key), v.name, v.plaintext, unhex(t, v.nonce))
		if err != nil {
			t.Fatal(err)
		}
		if got := hex.EncodeToString(sealed); got != v.sealed {
			t.Errorf("%s %q: sealed to %s, want %s", v.name, v.plaintext, got, v.sealed)
		}
	}
}

func TestOpensWhatAnyBackendStored(t *testing.T) {
	for _, v := range vectors {
		plain, err := OpenWith(unhex(t, v.key), v.name, unhex(t, v.sealed))
		if err != nil {
			t.Fatal(err)
		}
		if plain != v.plaintext {
			t.Errorf("%s: opened to %q, want %q", v.name, plain, v.plaintext)
		}
	}
}

func TestDoesNotOpenElsewhere(t *testing.T) {
	v := vectors[0]
	var refusal *Error
	if _, err := OpenWith(unhex(t, v.key), "users.name", unhex(t, v.sealed)); !errors.As(err, &refusal) {
		t.Errorf("opened under another column: %v", err)
	}
	if _, err := OpenWith(unhex(t, vectors[3].key), v.name, unhex(t, v.sealed)); !errors.As(err, &refusal) {
		t.Errorf("opened under another key: %v", err)
	}
	flipped := unhex(t, v.sealed)
	flipped[len(flipped)-1] ^= 1
	if _, err := OpenWith(unhex(t, v.key), v.name, flipped); !errors.As(err, &refusal) {
		t.Errorf("opened with a changed byte: %v", err)
	}
	versioned := unhex(t, v.sealed)
	versioned[0] = 2
	if _, err := OpenWith(unhex(t, v.key), v.name, versioned); err == nil || !strings.Contains(err.Error(), "layout version 2") {
		t.Errorf("another layout version: %v", err)
	}
}

func TestNeverStoresTheSameBytesTwice(t *testing.T) {
	v := vectors[0]
	once, err := SealWith(unhex(t, v.key), v.name, v.plaintext, nil)
	if err != nil {
		t.Fatal(err)
	}
	again, err := SealWith(unhex(t, v.key), v.name, v.plaintext, nil)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(once, again) {
		t.Error("two seals of one value stored the same bytes")
	}
	if bytes.Contains(once, []byte(v.plaintext)) {
		t.Error("the stored bytes hold the plaintext")
	}
}
`
  );
}

/** What the generated README says of sealed fields */
export function sealReadme(ir: IR, modulePath: string): string {
  if (!hasSealed(ir)) return "";
  const names = sealedNames(ir);
  return `
## Sealed fields

${names.map(n => `\`${n}\``).join(", ")} ${names.length === 1 ? "is" : "are"} sealed: encrypted with AES-256-GCM before ${names.length === 1 ? "it reaches" : "they reach"} the database, in a \`bytea\` column. The key is \`${SEAL_KEY_ENV}\` (${SEAL_KEY_HINT}). It is in no generated file; the server does not start without it, and nothing is ever sealed under a default.

- Keep the key as long as the data. A value sealed under one key does not open under another: a read answers 500 and the log names the column, never the value. Rotating the key is not built yet.
- The API opens a value only for a caller the field's \`read:\` rule allows, and for nobody when the field has none. It is in no event payload, and no list can filter, sort or search by it.
- Your own code reads one with \`seal.Open(seal.<TableColumn>, row.<Column>)\` and writes one with \`seal.Seal(seal.<TableColumn>, value)\`, from \`${modulePath}/generated/seal\`. A row you load yourself holds the stored bytes.
- A stored value is \`0x01\`, a 12-byte random nonce, the ciphertext and a 16-byte tag, bound to its table and column: copied into another column it does not open. Every OSL backend reads and writes the same bytes.
`;
}
