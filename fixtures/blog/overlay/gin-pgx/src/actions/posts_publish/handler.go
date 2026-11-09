// Fixture overlay: the user-owned handler the "publishing" scenario relies on.
package postspublish

import (
	"blog/generated/actions"
	"blog/generated/models"
)

// Handle marks the article published and answers the updated row.
func Handle(ctx *actions.Context, input actions.PostsPublishInput, row *models.Article) (*models.Article, error) {
	return models.ScanArticle(ctx.DB.QueryRow(ctx.Context(), `UPDATE `+models.ArticleTable+` SET "published" = true WHERE "id" = $1 RETURNING `+models.ArticleColumns, row.ID))
}
