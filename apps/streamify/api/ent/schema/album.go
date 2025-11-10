package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"github.com/google/uuid"
)

// Album holds the schema definition for the Album entity.
type Album struct {
	ent.Schema
}

// Fields of the Album.
func (Album) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).
			Default(uuid.New).
			Unique(),
		field.String("title").
			MaxLen(255).
			SchemaType(map[string]string{
				"postgres": "varchar(255)",
				"mysql":    "varchar(255)",
				"sqlite3":  "varchar(255)",
			}),
		field.UUID("artist_id", uuid.UUID{}),
		field.String("image_url").
			Optional(),
		field.Time("created_at").
			Default(time.Now),
	}
}

// Edges of the Album.
func (Album) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("artist", Artist.Type).
			Unique().
			Required().
			Field("artist_id"),
		edge.From("tracks", Track.Type).
			Ref("album"),
	}
}
