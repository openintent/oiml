// Fixture overlay: the user-owned handler the "private drafts" scenario relies on.
package announcementspublish

import (
	"blog/generated/actions"
	"blog/generated/models"
)

// Handle marks the announcement published and answers the updated row.
func Handle(ctx *actions.Context, input actions.AnnouncementsPublishInput, row *models.Announcement) (*models.Announcement, error) {
	return models.ScanAnnouncement(ctx.DB.QueryRow(ctx.Context(), `UPDATE `+models.AnnouncementTable+` SET "published" = true WHERE "id" = $1 RETURNING `+models.AnnouncementColumns, row.ID))
}
