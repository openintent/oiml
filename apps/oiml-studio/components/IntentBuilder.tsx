"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Plus, Trash2, X } from "lucide-react";

export interface IntentField {
  name: string;
  type: string;
  required?: boolean;
  unique?: boolean;
  default?: any;
  max_length?: number;
  array_type?: string;
  enum_values?: string[];
}

export interface Intent {
  kind: string;
  scope: string;
  entity?: string;
  fields?: IntentField[];
  relation?: {
    source_entity: string;
    target_entity: string;
    kind: string;
    field_name: string;
  };
  method?: string;
  path?: string;
  description?: string;
  capability?: string;
  framework?: string;
  provider?: string;
  config?: Record<string, any>;
}

interface IntentBuilderProps {
  intents: Intent[];
  onChange: (intents: Intent[]) => void;
}

const FIELD_TYPES = [
  "string",
  "text",
  "integer",
  "bigint",
  "float",
  "decimal",
  "boolean",
  "datetime",
  "date",
  "time",
  "uuid",
  "json",
  "enum",
  "array",
  "bytes",
];

const ARRAY_TYPES = [
  "string",
  "text",
  "integer",
  "bigint",
  "float",
  "decimal",
  "boolean",
  "uuid",
];

const RELATION_KINDS = [
  "one_to_one",
  "one_to_many",
  "many_to_one",
  "many_to_many",
];

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const CAPABILITIES = [
  "auth",
  "email",
  "storage",
  "file_stream",
  "sse",
  "websocket",
];

export function IntentBuilder({ intents, onChange }: IntentBuilderProps) {
  const [selectedIntentType, setSelectedIntentType] = useState<string>("");

  const addIntent = () => {
    if (!selectedIntentType) return;

    let newIntent: Intent = { kind: selectedIntentType, scope: "" };

    switch (selectedIntentType) {
      case "add_entity":
        newIntent = {
          kind: "add_entity",
          scope: "data",
          entity: "",
          fields: [],
        };
        break;
      case "add_field":
        newIntent = {
          kind: "add_field",
          scope: "data",
          entity: "",
          fields: [],
        };
        break;
      case "add_relation":
        newIntent = {
          kind: "add_relation",
          scope: "data",
          relation: {
            source_entity: "",
            target_entity: "",
            kind: "one_to_many",
            field_name: "",
          },
        };
        break;
      case "add_endpoint":
        newIntent = {
          kind: "add_endpoint",
          scope: "api",
          method: "GET",
          path: "",
          entity: "",
          description: "",
        };
        break;
      case "add_capability":
        newIntent = {
          kind: "add_capability",
          scope: "capability",
          capability: "auth",
          framework: "",
          provider: "",
        };
        break;
    }

    onChange([...intents, newIntent]);
    setSelectedIntentType("");
  };

  const removeIntent = (index: number) => {
    onChange(intents.filter((_, i) => i !== index));
  };

  const updateIntent = (index: number, updates: Partial<Intent>) => {
    const updated = [...intents];
    updated[index] = { ...updated[index], ...updates };
    onChange(updated);
  };

  const addField = (intentIndex: number) => {
    const updated = [...intents];
    if (!updated[intentIndex].fields) {
      updated[intentIndex].fields = [];
    }
    updated[intentIndex].fields!.push({
      name: "",
      type: "string",
      required: false,
    });
    onChange(updated);
  };

  const removeField = (intentIndex: number, fieldIndex: number) => {
    const updated = [...intents];
    if (updated[intentIndex].fields) {
      updated[intentIndex].fields = updated[intentIndex].fields!.filter(
        (_, i) => i !== fieldIndex
      );
      onChange(updated);
    }
  };

  const updateField = (
    intentIndex: number,
    fieldIndex: number,
    updates: Partial<IntentField>
  ) => {
    const updated = [...intents];
    if (updated[intentIndex].fields) {
      updated[intentIndex].fields![fieldIndex] = {
        ...updated[intentIndex].fields![fieldIndex],
        ...updates,
      };
      onChange(updated);
    }
  };

  return (
    <div className="space-y-4">
      {/* Add Intent Type Selector */}
      <div className="flex items-center gap-2">
        <Select
          value={selectedIntentType}
          onValueChange={setSelectedIntentType}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Add intent type..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="add_entity">Add Entity</SelectItem>
            <SelectItem value="add_field">Add Field</SelectItem>
            <SelectItem value="add_relation">Add Relation</SelectItem>
            <SelectItem value="add_endpoint">Add Endpoint</SelectItem>
            <SelectItem value="add_capability">Add Capability</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={addIntent} disabled={!selectedIntentType} size="sm">
          <Plus className="w-4 h-4" />
          Add
        </Button>
      </div>

      {/* Intents List */}
      <div className="space-y-4">
        {intents.map((intent, intentIndex) => (
          <Card key={intentIndex}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base capitalize">
                    {intent.kind.replace(/_/g, " ")}
                  </CardTitle>
                  <CardDescription>{intent.scope}</CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeIntent(intentIndex)}
                  className="text-red-600 dark:text-red-400"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Add Entity */}
              {intent.kind === "add_entity" && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Entity Name</label>
                    <Input
                      value={intent.entity || ""}
                      onChange={(e) =>
                        updateIntent(intentIndex, { entity: e.target.value })
                      }
                      placeholder="e.g., User, Post"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Fields</label>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => addField(intentIndex)}
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Add Field
                      </Button>
                    </div>
                    {intent.fields?.map((field, fieldIndex) => (
                      <Card key={fieldIndex} className="p-3">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1 grid grid-cols-2 gap-2">
                            <Input
                              placeholder="Field name"
                              value={field.name}
                              onChange={(e) =>
                                updateField(intentIndex, fieldIndex, {
                                  name: e.target.value,
                                })
                              }
                            />
                            <Select
                              value={field.type}
                              onValueChange={(value) =>
                                updateField(intentIndex, fieldIndex, {
                                  type: value,
                                })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {FIELD_TYPES.map((type) => (
                                  <SelectItem key={type} value={type}>
                                    {type}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeField(intentIndex, fieldIndex)}
                            className="ml-2"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={field.required || false}
                              onChange={(e) =>
                                updateField(intentIndex, fieldIndex, {
                                  required: e.target.checked,
                                })
                              }
                            />
                            Required
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={field.unique || false}
                              onChange={(e) =>
                                updateField(intentIndex, fieldIndex, {
                                  unique: e.target.checked,
                                })
                              }
                            />
                            Unique
                          </label>
                        </div>
                        {field.type === "array" && (
                          <div className="mt-2">
                            <label className="text-sm font-medium">
                              Array Type
                            </label>
                            <Select
                              value={field.array_type || ""}
                              onValueChange={(value) =>
                                updateField(intentIndex, fieldIndex, {
                                  array_type: value,
                                })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select array type" />
                              </SelectTrigger>
                              <SelectContent>
                                {ARRAY_TYPES.map((type) => (
                                  <SelectItem key={type} value={type}>
                                    {type}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        {field.type === "enum" && (
                          <div className="mt-2">
                            <label className="text-sm font-medium">
                              Enum Values (comma-separated)
                            </label>
                            <Input
                              placeholder="value1, value2, value3"
                              value={field.enum_values?.join(", ") || ""}
                              onChange={(e) =>
                                updateField(intentIndex, fieldIndex, {
                                  enum_values: e.target.value
                                    .split(",")
                                    .map((v) => v.trim())
                                    .filter((v) => v),
                                })
                              }
                            />
                          </div>
                        )}
                        {(field.max_length !== undefined ||
                          field.default !== undefined) && (
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            {field.type === "string" && (
                              <div>
                                <label className="text-sm font-medium">
                                  Max Length
                                </label>
                                <Input
                                  type="number"
                                  placeholder="255"
                                  value={field.max_length || ""}
                                  onChange={(e) =>
                                    updateField(intentIndex, fieldIndex, {
                                      max_length: e.target.value
                                        ? parseInt(e.target.value)
                                        : undefined,
                                    })
                                  }
                                />
                              </div>
                            )}
                            <div>
                              <label className="text-sm font-medium">
                                Default Value
                              </label>
                              <Input
                                placeholder="default"
                                value={
                                  field.default !== undefined
                                    ? String(field.default)
                                    : ""
                                }
                                onChange={(e) =>
                                  updateField(intentIndex, fieldIndex, {
                                    default: e.target.value || undefined,
                                  })
                                }
                              />
                            </div>
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                </>
              )}

              {/* Add Field */}
              {intent.kind === "add_field" && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Entity Name</label>
                    <Input
                      value={intent.entity || ""}
                      onChange={(e) =>
                        updateIntent(intentIndex, { entity: e.target.value })
                      }
                      placeholder="e.g., User"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Fields</label>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => addField(intentIndex)}
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Add Field
                      </Button>
                    </div>
                    {intent.fields?.map((field, fieldIndex) => (
                      <Card key={fieldIndex} className="p-3">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1 grid grid-cols-2 gap-2">
                            <Input
                              placeholder="Field name"
                              value={field.name}
                              onChange={(e) =>
                                updateField(intentIndex, fieldIndex, {
                                  name: e.target.value,
                                })
                              }
                            />
                            <Select
                              value={field.type}
                              onValueChange={(value) =>
                                updateField(intentIndex, fieldIndex, {
                                  type: value,
                                })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {FIELD_TYPES.map((type) => (
                                  <SelectItem key={type} value={type}>
                                    {type}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeField(intentIndex, fieldIndex)}
                            className="ml-2"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                </>
              )}

              {/* Add Relation */}
              {intent.kind === "add_relation" && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        Source Entity
                      </label>
                      <Input
                        value={intent.relation?.source_entity || ""}
                        onChange={(e) =>
                          updateIntent(intentIndex, {
                            relation: {
                              ...intent.relation!,
                              source_entity: e.target.value,
                            },
                          })
                        }
                        placeholder="e.g., Post"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        Target Entity
                      </label>
                      <Input
                        value={intent.relation?.target_entity || ""}
                        onChange={(e) =>
                          updateIntent(intentIndex, {
                            relation: {
                              ...intent.relation!,
                              target_entity: e.target.value,
                            },
                          })
                        }
                        placeholder="e.g., Comment"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        Relation Type
                      </label>
                      <Select
                        value={intent.relation?.kind || "one_to_many"}
                        onValueChange={(value) =>
                          updateIntent(intentIndex, {
                            relation: {
                              ...intent.relation!,
                              kind: value,
                            },
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RELATION_KINDS.map((kind) => (
                            <SelectItem key={kind} value={kind}>
                              {kind.replace(/_/g, " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Field Name</label>
                      <Input
                        value={intent.relation?.field_name || ""}
                        onChange={(e) =>
                          updateIntent(intentIndex, {
                            relation: {
                              ...intent.relation!,
                              field_name: e.target.value,
                            },
                          })
                        }
                        placeholder="e.g., comments"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Add Endpoint */}
              {intent.kind === "add_endpoint" && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Method</label>
                      <Select
                        value={intent.method || "GET"}
                        onValueChange={(value) =>
                          updateIntent(intentIndex, { method: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {HTTP_METHODS.map((method) => (
                            <SelectItem key={method} value={method}>
                              {method}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Path</label>
                      <Input
                        value={intent.path || ""}
                        onChange={(e) =>
                          updateIntent(intentIndex, { path: e.target.value })
                        }
                        placeholder="/users"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Entity (optional)
                    </label>
                    <Input
                      value={intent.entity || ""}
                      onChange={(e) =>
                        updateIntent(intentIndex, { entity: e.target.value })
                      }
                      placeholder="e.g., User"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Description (optional)
                    </label>
                    <Input
                      value={intent.description || ""}
                      onChange={(e) =>
                        updateIntent(intentIndex, {
                          description: e.target.value,
                        })
                      }
                      placeholder="Endpoint description"
                    />
                  </div>
                </>
              )}

              {/* Add Capability */}
              {intent.kind === "add_capability" && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Capability</label>
                      <Select
                        value={intent.capability || "auth"}
                        onValueChange={(value) =>
                          updateIntent(intentIndex, { capability: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CAPABILITIES.map((cap) => (
                            <SelectItem key={cap} value={cap}>
                              {cap}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Framework</label>
                      <Input
                        value={intent.framework || ""}
                        onChange={(e) =>
                          updateIntent(intentIndex, {
                            framework: e.target.value,
                          })
                        }
                        placeholder="e.g., next, gin"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Provider (optional)
                    </label>
                    <Input
                      value={intent.provider || ""}
                      onChange={(e) =>
                        updateIntent(intentIndex, { provider: e.target.value })
                      }
                      placeholder="e.g., clerk, auth0"
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {intents.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <p className="text-sm">No intents added yet</p>
          <p className="text-xs mt-1">
            Select an intent type above to get started
          </p>
        </div>
      )}
    </div>
  );
}






