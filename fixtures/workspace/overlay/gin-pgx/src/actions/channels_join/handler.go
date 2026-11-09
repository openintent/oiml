// Fixture overlay: the user-owned handler the "private and public channels" scenario relies on.
package channelsjoin

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"workspace/generated/actions"
	"workspace/generated/httpx"
	"workspace/generated/models"
)

// Handle adds the caller to the channel as a member; joining a channel they already belong to is a conflict.
func Handle(ctx *actions.Context, input actions.ChannelsJoinInput, row *models.Channel) (*models.Channel, error) {
	var existing int
	err := ctx.DB.QueryRow(ctx.Context(), `SELECT 1 FROM `+models.ChannelMemberTable+` WHERE "channel_id" = $1 AND "user_id" = $2`, row.ID, ctx.Session.UserID()).Scan(&existing)
	if err == nil {
		return nil, httpx.NewError(http.StatusConflict, "conflict", "Already a member of this channel")
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if _, err := ctx.DB.Exec(ctx.Context(), `INSERT INTO `+models.ChannelMemberTable+` ("channel_id", "user_id", "role") VALUES ($1, $2, 'member')`, row.ID, ctx.Session.UserID()); err != nil {
		return nil, err
	}
	return row, nil
}
