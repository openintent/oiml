// Created once by OSL (@osl/backend-gin-pgx). Publish the announcement. POST /api/announcements/{id}/publish: row is the Announcement; answer with the row to return it.
// You own this file: OSL never rewrites it.

package announcementspublish

import (
	"blog/generated/actions"
	"blog/generated/models"
)

// Handle runs the publish action. Return an *httpx.Error to answer with that status; ctx.DB is the pgx pool.
func Handle(ctx *actions.Context, input actions.AnnouncementsPublishInput, row *models.Announcement) (*models.Announcement, error) {
	return row, nil
}
