package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"github.com/google/uuid"
)

// Track holds the schema definition for the Track entity.
type Track struct {
	ent.Schema
}

// Fields of the Track.
func (Track) Fields() []ent.Field {
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
		field.UUID("album_id", uuid.UUID{}),
		field.Time("created_at").
			Default(time.Now),
	}
}

// Edges of the Track.
func (Track) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("album", Album.Type).
			Unique().
			Required().
			Field("album_id"),
	}
}

