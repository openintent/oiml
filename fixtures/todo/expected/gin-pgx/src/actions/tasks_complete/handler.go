// Created once by OSL (@osl/backend-gin-pgx). Mark the task done. POST /api/tasks/{id}/complete: row is the Task; answer with the row to return it.
// You own this file: OSL never rewrites it.

package taskscomplete

import (
	"todo/generated/actions"
	"todo/generated/models"
)

// Handle runs the complete action. Return an *httpx.Error to answer with that status; ctx.DB is the pgx pool.
func Handle(ctx *actions.Context, input actions.TasksCompleteInput, row *models.Task) (*models.Task, error) {
	return row, nil
}
