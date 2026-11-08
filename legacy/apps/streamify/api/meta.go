package main

import (
	"net/http"
	"strings"

	"streamify/ent"
	"streamify/ent/schema"

	entSchema "entgo.io/ent"
	"entgo.io/ent/schema/field"

	"github.com/gin-gonic/gin"
)

// getSchema returns the database schema information dynamically from Ent schemas
func getSchema(client *ent.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Define all schemas to introspect with their names
		schemaList := []struct {
			name   string
			fields func() []entSchema.Field
			edges  func() []entSchema.Edge
		}{
			{"User", schema.User{}.Fields, schema.User{}.Edges},
			{"Artist", schema.Artist{}.Fields, schema.Artist{}.Edges},
			{"Album", schema.Album{}.Fields, schema.Album{}.Edges},
			{"Track", schema.Track{}.Fields, schema.Track{}.Edges},
		}

		models := make([]map[string]interface{}, 0, len(schemaList))

		for _, item := range schemaList {
			model := extractModelInfo(item.name, item.fields, item.edges)
			if model != nil {
				models = append(models, model)
			}
		}

		c.JSON(http.StatusOK, gin.H{"models": models})
	}
}

// extractModelInfo extracts model information from Ent schema fields and edges
func extractModelInfo(modelName string, getFields func() []entSchema.Field, getEdges func() []entSchema.Edge) map[string]interface{} {
	// Get table name (default to lowercase plural of model name)
	tableName := strings.ToLower(modelName) + "s"

	// Get fields
	fields := getFields()
	fieldList := make([]map[string]interface{}, 0, len(fields))

	// Build a map of field names to their foreign key info from edges
	edgeMap := make(map[string]map[string]string)
	edges := getEdges()
	for _, e := range edges {
		edgeDesc := e.Descriptor()
		// Check if this edge has a field (foreign key relationship)
		if edgeDesc.Field != "" {
			// Get target entity name - use a simple heuristic based on field name
			targetName := "Unknown"
			fieldLower := strings.ToLower(edgeDesc.Field)
			if strings.Contains(fieldLower, "artist") {
				targetName = "Artist"
			} else if strings.Contains(fieldLower, "album") {
				targetName = "Album"
			} else if strings.Contains(fieldLower, "track") {
				targetName = "Track"
			} else if strings.Contains(fieldLower, "user") {
				targetName = "User"
			}

			// Get the target field (usually "id")
			targetField := "id"

			edgeMap[edgeDesc.Field] = map[string]string{
				"targetEntity": targetName,
				"targetField":  targetField,
			}
		}
	}

	for _, f := range fields {
		fieldDesc := f.Descriptor()
		fieldName := fieldDesc.Name
		fieldType := getFieldType(fieldDesc)

		fieldInfo := map[string]interface{}{
			"name": fieldName,
			"type": fieldType,
		}

		// Add attributes - check if field is optional by checking if it has a default or is nullable
		attributes := []string{}
		// Check if field is optional (not required)
		// In Ent, if a field doesn't have Required() called, it's optional
		// We can check this by seeing if Nillable is true or if there's no validator requiring it
		if fieldDesc.Nillable || fieldDesc.Default != nil {
			attributes = append(attributes, "@Optional")
		}
		if fieldDesc.Unique {
			attributes = append(attributes, "@Unique")
		}
		if len(attributes) > 0 {
			fieldInfo["attributes"] = attributes
		}

		// Add foreign key info if this field has a foreign key relationship
		if fkInfo, ok := edgeMap[fieldName]; ok {
			fieldInfo["foreignKey"] = fkInfo
		}

		fieldList = append(fieldList, fieldInfo)
	}

	return map[string]interface{}{
		"name":      modelName,
		"tableName": tableName,
		"fields":    fieldList,
	}
}

// getFieldType converts Ent field descriptor to a readable type string
func getFieldType(fd *field.Descriptor) string {
	fieldType := fd.Info.Type

	// Check common types using field type constants
	if fieldType == field.TypeUUID {
		return "UUID"
	}
	if fieldType == field.TypeString {
		return "String"
	}
	if fieldType == field.TypeInt {
		return "Int"
	}
	if fieldType == field.TypeInt64 {
		return "Int64"
	}
	if fieldType == field.TypeFloat64 {
		return "Float64"
	}
	if fieldType == field.TypeBool {
		return "Bool"
	}
	if fieldType == field.TypeTime {
		return "Time"
	}

	return "Unknown"
}

// getRoutes returns all registered API routes
func getRoutes(r *gin.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		endpoints := []map[string]string{
			{"method": "GET", "path": "/api/v1/users", "description": "Get all users"},
			{"method": "GET", "path": "/api/v1/users/:id", "description": "Get user by ID"},
			{"method": "POST", "path": "/api/v1/users", "description": "Create a new user"},
			{"method": "DELETE", "path": "/api/v1/users/:id", "description": "Delete user by ID"},
			{"method": "GET", "path": "/api/v1/artists", "description": "Get all artists"},
			{"method": "GET", "path": "/api/v1/artists/:id", "description": "Get artist by ID"},
			{"method": "POST", "path": "/api/v1/artists", "description": "Create a new artist"},
			{"method": "GET", "path": "/api/v1/artists/:id/albums", "description": "Get albums for an artist"},
			{"method": "GET", "path": "/api/v1/albums/:id", "description": "Get album by ID"},
			{"method": "POST", "path": "/api/v1/albums", "description": "Create a new album"},
			{"method": "GET", "path": "/api/v1/albums/:id/tracks", "description": "Get tracks for an album"},
			{"method": "POST", "path": "/api/v1/tracks", "description": "Create a new track"},
			{"method": "POST", "path": "/api/users", "description": "Create a new user (non-versioned)"},
			{"method": "GET", "path": "/api/schema", "description": "Get database schema"},
			{"method": "GET", "path": "/api/routes", "description": "Get all API routes"},
		}

		c.JSON(http.StatusOK, gin.H{"endpoints": endpoints})
	}
}
