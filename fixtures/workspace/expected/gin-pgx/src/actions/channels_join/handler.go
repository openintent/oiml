// Created once by OSL (@osl/backend-gin-pgx). Join. POST /api/channels/{id}/join: row is the Channel; answer with the row to return it.
// You own this file: OSL never rewrites it.

package channelsjoin

import (
	"workspace/generated/actions"
	"workspace/generated/models"
)

// Handle runs the join action. Return an *httpx.Error to answer with that status; ctx.DB is the pgx pool.
func Handle(ctx *actions.Context, input actions.ChannelsJoinInput, row *models.Channel) (*models.Channel, error) {
	return row, nil
}
