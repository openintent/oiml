// Created once by OSL (@osl/backend-gin-pgx). Reopen the article to comments. POST /api/posts/{id}/unlock: row is the Article; answer with the row to return it.
// You own this file: OSL never rewrites it.

package postsunlock

import (
	"blog/generated/actions"
	"blog/generated/models"
)

// Handle runs the unlock action. Return an *httpx.Error to answer with that status; ctx.DB is the pgx pool.
func Handle(ctx *actions.Context, input actions.PostsUnlockInput, row *models.Article) (*models.Article, error) {
	return row, nil
}
