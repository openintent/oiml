// Created once by OSL (@osl/backend-gin-pgx). Email the assignee about the task. POST /api/tasks/{id}/remind: row is the Task; answer with the row to return it.
// You own this file: OSL never rewrites it.

package tasksremind

import (
	"workspace/generated/actions"
	"workspace/generated/models"
)

// Handle runs the remind action. Return an *httpx.Error to answer with that status; ctx.DB is the pgx pool.
func Handle(ctx *actions.Context, input actions.TasksRemindInput, row *models.Task) (*models.Task, error) {
	return row, nil
}
