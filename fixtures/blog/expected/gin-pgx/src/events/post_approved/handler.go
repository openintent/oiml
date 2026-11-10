// Created once by OSL (@osl/backend-gin-pgx). Handler post_approved, run on posts.approve.
// You own this file: OSL never rewrites it.

package postapproved

import "blog/generated/models"

// Handle runs after the posts.approve action ran. Replace this with your logic.
func Handle(payload models.PublicArticle) error {
	_ = payload
	return nil
}
