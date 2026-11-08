import { HEADER, goFile } from "./util.js";

/** generated/email/email.go: one send function, three adapters. Static. */
export function emailFile(modulePath: string): string {
  return goFile(
    modulePath,
    HEADER("Email: logged to the console, sent through Resend, or captured in memory for tests."),
    "email",
    ["bytes", "context", "encoding/json", "errors", "io", "log", "net/http", "os", "strconv", "sync"],
    `// Email is one message to send.
type Email struct {
	To      string
	Subject string
	Text    string
	HTML    string
}

// Mode is how emails leave the process.
type Mode string

const (
	ModeLog     Mode = "log"
	ModeResend  Mode = "resend"
	ModeCapture Mode = "capture"
)

// CurrentMode reads OSL_EMAIL=log|resend|capture; without it, resend when RESEND_API_KEY is set, else log.
// capture keeps emails in memory and lets sign-in responses carry their tokens: only for tests.
func CurrentMode() Mode {
	switch Mode(os.Getenv("OSL_EMAIL")) {
	case ModeLog:
		return ModeLog
	case ModeResend:
		return ModeResend
	case ModeCapture:
		return ModeCapture
	}
	if os.Getenv("RESEND_API_KEY") != "" {
		return ModeResend
	}
	return ModeLog
}

func from() string {
	if v := os.Getenv("EMAIL_FROM"); v != "" {
		return v
	}
	return "no-reply@example.com"
}

var captured struct {
	sync.Mutex
	emails []Email
}

// Captured lists the emails sent while capturing, oldest first.
func Captured() []Email {
	captured.Lock()
	defer captured.Unlock()
	return append([]Email(nil), captured.emails...)
}

type resendBody struct {
	From    string   \`json:"from"\`
	To      []string \`json:"to"\`
	Subject string   \`json:"subject"\`
	Text    string   \`json:"text"\`
	HTML    string   \`json:"html,omitempty"\`
}

// Send delivers an email through the current mode.
func Send(ctx context.Context, email Email) error {
	switch CurrentMode() {
	case ModeCapture:
		captured.Lock()
		defer captured.Unlock()
		captured.emails = append(captured.emails, email)
		return nil
	case ModeResend:
		data, err := json.Marshal(resendBody{From: from(), To: []string{email.To}, Subject: email.Subject, Text: email.Text, HTML: email.HTML})
		if err != nil {
			return err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(data))
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+os.Getenv("RESEND_API_KEY"))
		req.Header.Set("Content-Type", "application/json")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			return err
		}
		defer res.Body.Close()
		if res.StatusCode >= 300 {
			body, _ := io.ReadAll(res.Body)
			return errors.New("Resend answered " + strconv.Itoa(res.StatusCode) + ": " + string(body))
		}
		return nil
	}
	log.Printf("[email] to %s: %s\\n%s", email.To, email.Subject, email.Text)
	return nil
}
`
  );
}
