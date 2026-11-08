// Created once by OSL (@osl/backend-gin-pgx). Delete every task that is done. POST /api/tasks/clear_done, over the whole collection.
// You own this file: OSL never rewrites it.

package taskscleardone

import "todo/generated/actions"

// Handle runs the clear_done action. Return an *httpx.Error to answer with that status; ctx.DB is the pgx pool.
func Handle(ctx *actions.Context, input actions.TasksClearDoneInput) (actions.TasksClearDoneResult, error) {
	return actions.TasksClearDoneResult{Count: 0}, nil
}
