// Created once by OSL (@osl/backend-gin-pgx). Handler post_archived, run on posts.archive as a background job.
// You own this file: OSL never rewrites it.

package postarchived

import "blog/generated/models"

// Handle runs after the posts.archive action ran. Replace this with your logic.
func Handle(payload models.PublicArticle) error {
	_ = payload
	return nil
}
