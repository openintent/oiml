// Fixture overlay: the user-owned handler the "integrations and sealed secrets" scenario relies on.
package integrationssign

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"

	"blog/generated/actions"
	"blog/generated/httpx"
	"blog/generated/models"
	"blog/generated/seal"
)

// Handle signs the payload with the integration's secret. The row holds the secret as it is stored, sealed; this
// is the one place that opens it, and the signature is all that leaves.
func Handle(ctx *actions.Context, input actions.IntegrationsSignInput, row *models.Integration) (actions.IntegrationsSignResult, error) {
	if row.Secret == nil {
		return actions.IntegrationsSignResult{}, httpx.NewError(http.StatusConflict, "conflict", "This integration has no secret")
	}
	secret, err := seal.Open(seal.IntegrationsSecret, row.Secret)
	if err != nil {
		return actions.IntegrationsSignResult{}, err
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(input.Payload))
	return actions.IntegrationsSignResult{Signature: hex.EncodeToString(mac.Sum(nil))}, nil
}
