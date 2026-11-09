// Created once by OSL (@osl/backend-gin-pgx). Hooks around the generated follows handlers.
// You own this file: OSL never rewrites it.

package follows

import (
	"blog/generated/hooks"
	"blog/generated/models"
)

// Return an *httpx.Error from a before-hook to reject the request with that status.

// BeforeCreate may change the values about to be inserted.
func BeforeCreate(ctx *hooks.Context, input models.Values) (models.Values, error) {
	return input, nil
}

// AfterCreate runs once the row exists.
func AfterCreate(ctx *hooks.Context, row *models.Follow) error {
	return nil
}

// BeforeUpdate may change the patch about to be applied; an empty patch leaves the row as it is.
func BeforeUpdate(ctx *hooks.Context, existing *models.Follow, patch models.Values) (models.Values, error) {
	return patch, nil
}

// AfterUpdate runs once the row is updated.
func AfterUpdate(ctx *hooks.Context, row *models.Follow) error {
	return nil
}

// BeforeDelete runs before the row is deleted.
func BeforeDelete(ctx *hooks.Context, row *models.Follow) error {
	return nil
}

// AfterDelete runs once the row is gone.
func AfterDelete(ctx *hooks.Context, row *models.Follow) error {
	return nil
}
