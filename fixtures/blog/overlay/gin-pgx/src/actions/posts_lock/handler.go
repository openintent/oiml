// Fixture overlay: the user-owned handler the "locked articles" scenario relies on.
package postslock

import (
	"blog/generated/actions"
	"blog/generated/models"
)

// Handle closes the article to new comments and answers the updated row.
func Handle(ctx *actions.Context, input actions.PostsLockInput, row *models.Article) (*models.Article, error) {
	return models.ScanArticle(ctx.DB.QueryRow(ctx.Context(), `UPDATE `+models.ArticleTable+` SET "locked" = true WHERE "id" = $1 RETURNING `+models.ArticleColumns, row.ID))
}
