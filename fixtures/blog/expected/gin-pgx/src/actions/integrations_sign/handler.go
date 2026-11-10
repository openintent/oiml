// Created once by OSL (@osl/backend-gin-pgx). Sign a payload with the integration's secret (HMAC-SHA256, in hexadecimal). POST /api/integrations/{id}/sign: row is the Integration; answer with the row to return it.
// You own this file: OSL never rewrites it.

package integrationssign

import (
	"blog/generated/actions"
	"blog/generated/models"
)

// Handle runs the sign action. Return an *httpx.Error to answer with that status; ctx.DB is the pgx pool.
func Handle(ctx *actions.Context, input actions.IntegrationsSignInput, row *models.Integration) (actions.IntegrationsSignResult, error) {
	return actions.IntegrationsSignResult{Signature: ""}, nil
}
