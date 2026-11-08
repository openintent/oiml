// Created once by OSL (@osl/backend-gin-pgx). Handler post_created, run on Article.created.
// You own this file: OSL never rewrites it.

package postcreated

import "blog/generated/models"

// Handle runs after Article is created. Replace this with your logic.
func Handle(payload models.PublicArticle) error {
	_ = payload
	return nil
}
