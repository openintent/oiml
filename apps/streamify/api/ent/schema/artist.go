package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"github.com/google/uuid"
)

// Artist holds the schema definition for the Artist entity.
type Artist struct {
	ent.Schema
}

// Fields of the Artist.
func (Artist) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).
			Default(uuid.New).
			Unique(),
		field.String("name").
			MaxLen(255).
			SchemaType(map[string]string{
				"postgres": "varchar(255)",
				"mysql":    "varchar(255)",
				"sqlite3":  "varchar(255)",
			}),
		field.Time("created_at").
			Default(time.Now),
	}
}

// Edges of the Artist.
func (Artist) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("albums", Album.Type).
			Ref("artist"),
	}
}
