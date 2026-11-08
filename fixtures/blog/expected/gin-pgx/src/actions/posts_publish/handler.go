// Created once by OSL (@osl/backend-gin-pgx). Mark the article published. POST /api/posts/{id}/publish: row is the Article; answer with the row to return it.
// You own this file: OSL never rewrites it.

package postspublish

import (
	"blog/generated/actions"
	"blog/generated/models"
)

// Handle runs the publish action. Return an *httpx.Error to answer with that status; ctx.DB is the pgx pool.
func Handle(ctx *actions.Context, input actions.PostsPublishInput, row *models.Article) (*models.Article, error) {
	return row, nil
}
