// Fixture overlay: the user-owned handler the "banning" scenario relies on.
package usersban

import (
	"time"

	"blog/generated/actions"
	"blog/generated/models"
)

// Handle bans the user: it records the flag, the time and the reason, and answers the updated row.
func Handle(ctx *actions.Context, input actions.UsersBanInput, row *models.User) (*models.User, error) {
	now := time.Now().UTC()
	_, err := ctx.DB.Exec(ctx.Context(),
		`UPDATE `+models.UserTable+` SET "banned" = true, "banned_at" = $2, "ban_reason" = $3 WHERE "id" = $1`,
		row.ID, now, input.Reason)
	if err != nil {
		return nil, err
	}
	row.Banned = true
	row.BannedAt = &now
	row.BanReason = &input.Reason
	return row, nil
}
