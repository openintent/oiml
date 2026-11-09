// Fixture overlay: the user-owned handler the "due reminders" scenario relies on.
package tasksremind

import (
	"workspace/generated/actions"
	"workspace/generated/email"
	"workspace/generated/models"
)

// Handle emails the assignee once about the task and records when; a task without an assignee, or already reminded, is left alone.
func Handle(ctx *actions.Context, input actions.TasksRemindInput, row *models.Task) (*models.Task, error) {
	if row.RemindedAt != nil || row.AssigneeID == nil {
		return row, nil
	}
	var to string
	if err := ctx.DB.QueryRow(ctx.Context(), `SELECT "email" FROM `+models.UserTable+` WHERE "id" = $1`, *row.AssigneeID).Scan(&to); err != nil {
		return nil, err
	}
	if err := email.Send(ctx.Context(), email.Email{To: to, Subject: "Reminder: " + row.Title, Text: row.Title + " is due."}); err != nil {
		return nil, err
	}
	return models.ScanTask(ctx.DB.QueryRow(ctx.Context(), `UPDATE `+models.TaskTable+` SET "reminded_at" = $2 WHERE "id" = $1 RETURNING `+models.TaskColumns, row.ID, ctx.Now))
}
