// Fixture overlay: the event handler the "integrations and sealed secrets" scenario relies on.
package integrationcreated

import (
	"errors"

	"blog/generated/models"
)

// Handle fails when the payload carries a sealed field: the create it follows then answers 500 and the scenario
// fails. An event's payload is the row as the server reads it, and the server never reads a sealed value.
func Handle(payload models.PublicIntegration) error {
	if payload.Secret.Present || payload.Token.Present {
		return errors.New("a sealed field reached an event payload")
	}
	return nil
}
