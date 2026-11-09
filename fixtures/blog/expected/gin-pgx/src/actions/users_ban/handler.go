// Created once by OSL (@osl/backend-gin-pgx). Ban the user, recording when and why. POST /api/users/{id}/ban: row is the User; answer with the row to return it.
// You own this file: OSL never rewrites it.

package usersban

import (
	"blog/generated/actions"
	"blog/generated/models"
)

// Handle runs the ban action. Return an *httpx.Error to answer with that status; ctx.DB is the pgx pool.
func Handle(ctx *actions.Context, input actions.UsersBanInput, row *models.User) (*models.User, error) {
	return row, nil
}
