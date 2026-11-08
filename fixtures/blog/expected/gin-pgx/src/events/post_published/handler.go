// Created once by OSL (@osl/backend-gin-pgx). Handler post_published, run on posts.publish as a background job.
// You own this file: OSL never rewrites it.

package postpublished

import "blog/generated/models"

// Handle runs after the posts.publish action ran. Replace this with your logic.
func Handle(payload models.PublicArticle) error {
	_ = payload
	return nil
}
