// Created once by OSL (@osl/backend-gin-pgx). Unpublish every article. POST /api/posts/unpublish_all, over the whole collection.
// You own this file: OSL never rewrites it.

package postsunpublishall

import "blog/generated/actions"

// Handle runs the unpublish_all action. Return an *httpx.Error to answer with that status; ctx.DB is the pgx pool.
func Handle(ctx *actions.Context, input actions.PostsUnpublishAllInput) (actions.PostsUnpublishAllResult, error) {
	return actions.PostsUnpublishAllResult{Count: 0}, nil
}
