// Fixture overlay: the user-owned handler the "completing tasks" scenario relies on.
package taskscleardone

import (
	"todo/generated/actions"
	"todo/generated/models"
)

// Handle deletes every task that is done and answers how many it removed.
func Handle(ctx *actions.Context, input actions.TasksClearDoneInput) (actions.TasksClearDoneResult, error) {
	tag, err := ctx.DB.Exec(ctx.Gin.Request.Context(), `DELETE FROM `+models.TaskTable+` WHERE "status" = 'done'`)
	if err != nil {
		return actions.TasksClearDoneResult{}, err
	}
	return actions.TasksClearDoneResult{Count: int(tag.RowsAffected())}, nil
}
