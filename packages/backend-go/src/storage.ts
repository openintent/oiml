import { HEADER, goFile } from "./util.js";

/** generated/storage/storage.go: local disk by default, any S3-compatible service by env. Static. */
export function storageFile(modulePath: string): string {
  return goFile(
    modulePath,
    HEADER("File storage: the local disk, or an S3-compatible bucket when S3_BUCKET is set."),
    "storage",
    [
      "context",
      "errors",
      "io",
      "net/url",
      "os",
      "path/filepath",
      "strings",
      "sync",
      "time",
      "github.com/aws/aws-sdk-go-v2/aws",
      "github.com/aws/aws-sdk-go-v2/config",
      "github.com/aws/aws-sdk-go-v2/credentials",
      "github.com/aws/aws-sdk-go-v2/service/s3"
    ],
    `// Kind is which adapter stores the bytes.
type Kind string

const (
	KindLocal Kind = "local"
	KindS3    Kind = "s3"
)

const uploadURLSeconds = 900

const downloadURLSeconds = 300

// CurrentKind reads OSL_STORAGE=local|s3; without it, S3 when S3_BUCKET is set, else the local disk.
// Local: OSL_STORAGE_DIR (default ./storage). S3: S3_BUCKET, S3_REGION (default us-east-1), S3_ENDPOINT (R2, MinIO,
// Supabase), S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE=true for MinIO and Supabase.
func CurrentKind() Kind {
	switch Kind(os.Getenv("OSL_STORAGE")) {
	case KindLocal:
		return KindLocal
	case KindS3:
		return KindS3
	}
	if os.Getenv("S3_BUCKET") != "" {
		return KindS3
	}
	return KindLocal
}

func localDir() string {
	if v := os.Getenv("OSL_STORAGE_DIR"); v != "" {
		return v
	}
	return "./storage"
}

// UploadTarget is where a client PUTs a file's bytes.
type UploadTarget struct {
	URL     string            \`json:"url"\`
	Method  string            \`json:"method"\`
	Headers map[string]string \`json:"headers"\`
}

// Target answers where to PUT a file's bytes: back to this API for local storage, a presigned URL for S3.
func Target(ctx context.Context, key string, contentType string, localURL string) (UploadTarget, error) {
	headers := map[string]string{"content-type": contentType}
	if CurrentKind() == KindLocal {
		return UploadTarget{URL: localURL, Method: "PUT", Headers: headers}, nil
	}
	client, err := s3Client(ctx)
	if err != nil {
		return UploadTarget{}, err
	}
	signed, err := s3.NewPresignClient(client).PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(bucket()),
		Key:         aws.String(key),
		ContentType: aws.String(contentType),
	}, s3.WithPresignExpires(uploadURLSeconds*time.Second))
	if err != nil {
		return UploadTarget{}, err
	}
	return UploadTarget{URL: signed.URL, Method: "PUT", Headers: headers}, nil
}

// Size answers the size of the stored bytes, or -1 when nothing was uploaded yet.
func Size(ctx context.Context, key string) (int64, error) {
	if CurrentKind() == KindLocal {
		path, err := localPath(key)
		if err != nil {
			return -1, err
		}
		info, err := os.Stat(path)
		if err != nil {
			return -1, nil
		}
		return info.Size(), nil
	}
	client, err := s3Client(ctx)
	if err != nil {
		return -1, err
	}
	head, err := client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(bucket()), Key: aws.String(key)})
	if err != nil {
		return -1, nil
	}
	if head.ContentLength == nil {
		return 0, nil
	}
	return *head.ContentLength, nil
}

// PutLocal writes an uploaded body to the local disk and answers its size. Local storage only.
func PutLocal(key string, body io.Reader) (int64, error) {
	path, err := localPath(key)
	if err != nil {
		return 0, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return 0, err
	}
	file, err := os.Create(path)
	if err != nil {
		return 0, err
	}
	size, err := io.Copy(file, body)
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	return size, err
}

// OpenLocal opens the stored bytes. Local storage only.
func OpenLocal(key string) (*os.File, error) {
	path, err := localPath(key)
	if err != nil {
		return nil, err
	}
	return os.Open(path)
}

// InlineType is whether a browser may show the type inline; everything else downloads.
func InlineType(contentType string) bool {
	return strings.HasPrefix(contentType, "image/") || contentType == "application/pdf" || strings.HasPrefix(contentType, "video/") || strings.HasPrefix(contentType, "audio/")
}

// ContentDisposition renders the header that names a download (or inline view) after the file.
func ContentDisposition(name string, contentType string) string {
	safe := strings.Map(func(r rune) rune {
		if r < 0x20 || r > 0x7e || r == '"' || r == '\\\\' {
			return '_'
		}
		return r
	}, name)
	disposition := "attachment"
	if InlineType(contentType) {
		disposition = "inline"
	}
	return disposition + \`; filename="\` + safe + \`"; filename*=UTF-8''\` + url.PathEscape(name)
}

// DownloadURL answers a short-lived URL that serves the bytes with the right type and disposition. S3 only.
func DownloadURL(ctx context.Context, key string, name string, contentType string) (string, error) {
	client, err := s3Client(ctx)
	if err != nil {
		return "", err
	}
	signed, err := s3.NewPresignClient(client).PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket:                     aws.String(bucket()),
		Key:                        aws.String(key),
		ResponseContentType:        aws.String(contentType),
		ResponseContentDisposition: aws.String(ContentDisposition(name, contentType)),
	}, s3.WithPresignExpires(downloadURLSeconds*time.Second))
	if err != nil {
		return "", err
	}
	return signed.URL, nil
}

// Remove deletes the stored bytes; a missing local file is not an error.
func Remove(ctx context.Context, key string) error {
	if CurrentKind() == KindLocal {
		path, err := localPath(key)
		if err != nil {
			return err
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	client, err := s3Client(ctx)
	if err != nil {
		return err
	}
	_, err = client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(bucket()), Key: aws.String(key)})
	return err
}

func localPath(key string) (string, error) {
	root, err := filepath.Abs(localDir())
	if err != nil {
		return "", err
	}
	resolved := filepath.Join(root, filepath.FromSlash(key))
	if !strings.HasPrefix(resolved, root+string(filepath.Separator)) {
		return "", errors.New("invalid storage key")
	}
	return resolved, nil
}

func bucket() string {
	return os.Getenv("S3_BUCKET")
}

var s3Once struct {
	sync.Mutex
	client *s3.Client
	err    error
}

// s3Client builds the S3 client once from the environment.
func s3Client(ctx context.Context) (*s3.Client, error) {
	s3Once.Lock()
	defer s3Once.Unlock()
	if s3Once.client != nil || s3Once.err != nil {
		return s3Once.client, s3Once.err
	}
	if bucket() == "" {
		s3Once.err = errors.New("S3_BUCKET is not set")
		return nil, s3Once.err
	}
	region := os.Getenv("S3_REGION")
	if region == "" {
		region = "us-east-1"
	}
	options := []func(*config.LoadOptions) error{config.WithRegion(region)}
	if id, secret := os.Getenv("S3_ACCESS_KEY_ID"), os.Getenv("S3_SECRET_ACCESS_KEY"); id != "" && secret != "" {
		options = append(options, config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(id, secret, "")))
	}
	cfg, err := config.LoadDefaultConfig(ctx, options...)
	if err != nil {
		s3Once.err = err
		return nil, err
	}
	s3Once.client = s3.NewFromConfig(cfg, func(o *s3.Options) {
		if endpoint := os.Getenv("S3_ENDPOINT"); endpoint != "" {
			o.BaseEndpoint = aws.String(endpoint)
		}
		o.UsePathStyle = os.Getenv("S3_FORCE_PATH_STYLE") == "true"
	})
	return s3Once.client, nil
}
`
  );
}
