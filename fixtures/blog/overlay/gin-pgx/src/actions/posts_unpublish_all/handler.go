// Fixture overlay: the user-owned handler the "publishing" scenario relies on.
package postsunpublishall

import (
	"blog/generated/actions"
	"blog/generated/models"
)

// Handle unpublishes every published article and answers how many it touched.
func Handle(ctx *actions.Context, input actions.PostsUnpublishAllInput) (actions.PostsUnpublishAllResult, error) {
	tag, err := ctx.DB.Exec(ctx.Gin.Request.Context(), `UPDATE `+models.ArticleTable+` SET "published" = false WHERE "published" = true`)
	if err != nil {
		return actions.PostsUnpublishAllResult{}, err
	}
	return actions.PostsUnpublishAllResult{Count: int(tag.RowsAffected())}, nil
}
