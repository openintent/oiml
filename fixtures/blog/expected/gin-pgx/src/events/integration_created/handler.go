// Created once by OSL (@osl/backend-gin-pgx). Handler integration_created, run on Integration.created.
// You own this file: OSL never rewrites it.

package integrationcreated

import "blog/generated/models"

// Handle runs after Integration is created. Replace this with your logic.
func Handle(payload models.PublicIntegration) error {
	_ = payload
	return nil
}
