package schema

import (
	"time"

	"github.com/google/uuid"
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
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
			MaxLen(255),
		field.UUID("artist_id", uuid.UUID{}),
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
	}
}

