// Fixture overlay: the user-owned handler the "completing tasks" scenario relies on.
package taskscomplete

import (
	"todo/generated/actions"
	"todo/generated/models"
)

// Handle marks the task done and answers the updated row.
func Handle(ctx *actions.Context, input actions.TasksCompleteInput, row *models.Task) (*models.Task, error) {
	return models.ScanTask(ctx.DB.QueryRow(ctx.Context(), `UPDATE `+models.TaskTable+` SET "status" = 'done' WHERE "id" = $1 RETURNING `+models.TaskColumns, row.ID))
}
