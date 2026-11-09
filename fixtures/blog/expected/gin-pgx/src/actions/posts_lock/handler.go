// Created once by OSL (@osl/backend-gin-pgx). Close the article to new comments. POST /api/posts/{id}/lock: row is the Article; answer with the row to return it.
// You own this file: OSL never rewrites it.

package postslock

import (
	"blog/generated/actions"
	"blog/generated/models"
)

// Handle runs the lock action. Return an *httpx.Error to answer with that status; ctx.DB is the pgx pool.
func Handle(ctx *actions.Context, input actions.PostsLockInput, row *models.Article) (*models.Article, error) {
	return row, nil
}
