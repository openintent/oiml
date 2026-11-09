// Fixture overlay: the user-owned handler the "locked articles" scenario relies on.
package postsunlock

import (
	"blog/generated/actions"
	"blog/generated/models"
)

// Handle reopens the article to comments and answers the updated row.
func Handle(ctx *actions.Context, input actions.PostsUnlockInput, row *models.Article) (*models.Article, error) {
	return models.ScanArticle(ctx.DB.QueryRow(ctx.Context(), `UPDATE `+models.ArticleTable+` SET "locked" = false WHERE "id" = $1 RETURNING `+models.ArticleColumns, row.ID))
}
