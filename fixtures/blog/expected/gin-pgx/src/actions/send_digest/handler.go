// Created once by OSL (@osl/backend-gin-pgx). Email a digest of recent articles. POST /api/actions/send_digest.
// You own this file: OSL never rewrites it.

package senddigest

import "blog/generated/actions"

// Handle runs the send_digest action. Return an *httpx.Error to answer with that status; ctx.DB is the pgx pool.
func Handle(ctx *actions.Context, input actions.SendDigestInput) (actions.SendDigestResult, error) {
	return actions.SendDigestResult{Sent: 0}, nil
}
