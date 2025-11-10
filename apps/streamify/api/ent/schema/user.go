package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"github.com/google/uuid"
)

// User holds the schema definition for the User entity.
type User struct {
	ent.Schema
}

// Fields of the User.
func (User) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).
			Default(uuid.New).
			Unique(),
		field.String("email").
			MaxLen(255).
			SchemaType(map[string]string{
				"postgres": "varchar(255)",
				"mysql":    "varchar(255)",
				"sqlite3":  "varchar(255)",
			}).
			Unique(),
		field.String("first_name").
			MaxLen(255).
			SchemaType(map[string]string{
				"postgres": "varchar(255)",
				"mysql":    "varchar(255)",
				"sqlite3":  "varchar(255)",
			}).
			Optional(),
		field.String("last_name").
			MaxLen(255).
			SchemaType(map[string]string{
				"postgres": "varchar(255)",
				"mysql":    "varchar(255)",
				"sqlite3":  "varchar(255)",
			}).
			Optional(),
		field.String("password").
			Sensitive().
			Optional().
			SchemaType(map[string]string{
				"postgres": "varchar(255)",
				"mysql":    "varchar(255)",
				"sqlite3":  "varchar(255)",
			}),
	}
}

// Edges of the User.
func (User) Edges() []ent.Edge {
	return nil
}
