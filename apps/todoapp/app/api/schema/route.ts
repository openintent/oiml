import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

interface ModelField {
  name: string;
  type: string;
  attributes?: string[];
  foreignKey?: {
    targetEntity: string;
    targetField: string;
  };
}

interface Model {
  name: string;
  tableName: string;
  fields: ModelField[];
}

export async function GET() {
  try {
    const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
    const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
    
    const models: Model[] = [];
    // Match model blocks (handles multiline with [\s\S])
    const modelRegex = /model\s+(\w+)\s*\{([\s\S]*?)\}/g;
    const tableMapRegex = /@@map\(["']([^"']+)["']\)/;
    
    // First pass: build entity-to-table name mapping
    const entityToTableMap = new Map<string, string>();
    let match;
    const allMatches: Array<{ modelName: string; modelBody: string }> = [];
    
    // Reset regex to start from beginning
    modelRegex.lastIndex = 0;
    while ((match = modelRegex.exec(schemaContent)) !== null) {
      const modelName = match[1];
      const modelBody = match[2];
      allMatches.push({ modelName, modelBody });
      
      // Find table name for this entity
      const tableMatch = modelBody.match(tableMapRegex);
      const tableName = tableMatch ? tableMatch[1] : modelName.toLowerCase() + 's';
      entityToTableMap.set(modelName, tableName);
    }
    
    // Second pass: parse each model with entity-to-table mapping available
    for (const { modelName, modelBody } of allMatches) {
      // Find table name
      const tableMatch = modelBody.match(tableMapRegex);
      const tableName = tableMatch ? tableMatch[1] : modelName.toLowerCase() + 's';
      
      // Parse fields and relations
      const fields: ModelField[] = [];
      const lines = modelBody.split('\n');
      
      // First pass: collect relation information to identify foreign keys
      const relationMap = new Map<string, { targetEntity: string; targetField: string }>();
      
      for (const line of lines) {
        const trimmed = line.trim();
        
        // Look for relation fields: "fieldName EntityName @relation(fields: [fk_field], references: [target_field])"
        // Handle flexible spacing in the relation syntax
        const relationMatch = trimmed.match(/^(\w+)\s+(\w+)\s+@relation\(fields:\s*\[(\w+)\],\s*references:\s*\[(\w+)\]\)/);
        if (relationMatch) {
          const relationFieldName = relationMatch[1];
          const targetEntity = relationMatch[2];
          const foreignKeyFieldName = relationMatch[3];
          const targetField = relationMatch[4];
          
          relationMap.set(foreignKeyFieldName, {
            targetEntity,
            targetField
          });
        }
      }
      
      // Second pass: parse all fields
      for (const line of lines) {
        const trimmed = line.trim();
        
        // Skip comments, special directives, and empty lines
        if (
          trimmed.startsWith('//') ||
          trimmed.startsWith('@@') ||
          !trimmed ||
          trimmed === '{' ||
          trimmed === '}'
        ) {
          continue;
        }
        
        // Skip relation fields (they're not actual database columns)
        // They look like: "fieldName EntityName @relation(...)"
        if (/^\w+\s+\w+\s+@relation/.test(trimmed)) {
          continue;
        }
        
        // Extract field name and type
        // Handle both regular types and array types (e.g., "String" or "String[]")
        const fieldMatch = trimmed.match(/^(\w+)\s+(\w+)(\[\])?/);
        if (!fieldMatch) continue;
        
        const fieldName = fieldMatch[1];
        let fieldType = fieldMatch[2];
        const isArray = !!fieldMatch[3]; // true if [] is present
        const attributes: string[] = [];
        
        // Extract attributes
        const attrMatches = trimmed.matchAll(/@(\w+(?:\([^)]+\))?)/g);
        for (const attrMatch of attrMatches) {
          attributes.push('@' + attrMatch[1]);
        }
        
        // Format type nicely
        if (fieldType === 'String' && trimmed.includes('@db.Uuid')) {
          fieldType = 'String (UUID)';
        }
        
        // Mark as array if detected
        if (isArray) {
          fieldType = fieldType + '[]';
        }
        
        // Check if this field is a foreign key
        const foreignKeyInfo = relationMap.get(fieldName);
        
        fields.push({
          name: fieldName,
          type: fieldType,
          attributes: attributes.length > 0 ? attributes : undefined,
          foreignKey: foreignKeyInfo
        });
      }
      
      if (fields.length > 0) {
        models.push({
          name: modelName,
          tableName,
          fields,
        });
      }
    }
    
    return NextResponse.json({ success: true, models }, { status: 200 });
  } catch (error) {
    console.error('Error reading Prisma schema:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read schema',
      },
      { status: 500 }
    );
  }
}

