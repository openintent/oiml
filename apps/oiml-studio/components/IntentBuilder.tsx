"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2, X, Database, Code, Zap, FileText, MoreVertical, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";

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
  "bytes"
];

const ARRAY_TYPES = ["string", "text", "integer", "bigint", "float", "decimal", "boolean", "uuid"];

const RELATION_KINDS = ["one_to_one", "one_to_many", "many_to_one", "many_to_many"];

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const CAPABILITIES = ["auth", "email", "storage", "file_stream", "sse", "websocket"];

const INTENT_TYPES = [
  { value: "add_entity", label: "Add Entity" },
  { value: "add_field", label: "Add Field" },
  { value: "add_relation", label: "Add Relation" },
  { value: "add_endpoint", label: "Add Endpoint" },
  { value: "add_capability", label: "Add Capability" }
];

export function IntentBuilder({ intents, onChange }: IntentBuilderProps) {
  const [selectedIntentType, setSelectedIntentType] = useState<string>("");
  const [tempIntent, setTempIntent] = useState<Intent | null>(null);

  const getIntentIcon = (kind: string) => {
    switch (kind) {
      case "add_entity":
      case "add_field":
      case "add_relation":
      case "remove_field":
      case "remove_entity":
      case "rename_entity":
      case "rename_field":
        return <Database className="w-4 h-4" />;
      case "add_endpoint":
      case "update_endpoint":
        return <Code className="w-4 h-4" />;
      case "add_capability":
        return <Zap className="w-4 h-4" />;
      default:
        return <FileText className="w-4 h-4" />;
    }
  };

  const toHumanReadable = (str: string): string => {
    if (!str) return "";
    let result = str.replace(/[_-]/g, " ");
    result = result.replace(/([a-z])([A-Z])/g, "$1 $2");
    const words = result.split(/\s+/);
    const capitalized = words.map(word => {
      if (word.toLowerCase() === "email") {
        return "E-mail";
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });
    return capitalized.join(" ");
  };

  const getMethodColor = (method: string) => {
    const methodUpper = method.toUpperCase();
    switch (methodUpper) {
      case "GET":
        return "text-green-600 dark:text-green-400";
      case "POST":
      case "PUT":
      case "PATCH":
        return "text-orange-600 dark:text-orange-400";
      case "DELETE":
        return "text-red-600 dark:text-red-400";
      case "OPTIONS":
        return "text-gray-600 dark:text-gray-400";
      default:
        return "text-gray-600 dark:text-gray-400";
    }
  };

  const createIntent = (intentType: string): Intent => {
    switch (intentType) {
      case "add_entity":
        return {
          kind: "add_entity",
          scope: "data",
          entity: "",
          fields: []
        };
      case "add_field":
        return {
          kind: "add_field",
          scope: "data",
          entity: "",
          fields: []
        };
      case "add_relation":
        return {
          kind: "add_relation",
          scope: "data",
          relation: {
            source_entity: "",
            target_entity: "",
            kind: "one_to_many",
            field_name: ""
          }
        };
      case "add_endpoint":
        return {
          kind: "add_endpoint",
          scope: "api",
          method: "GET",
          path: "",
          entity: "",
          description: ""
        };
      case "add_capability":
        return {
          kind: "add_capability",
          scope: "capability",
          capability: "auth",
          framework: "",
          provider: ""
        };
      default:
        return { kind: intentType, scope: "" };
    }
  };

  const handleChipClick = (intentType: string) => {
    setSelectedIntentType(intentType);
    setTempIntent(createIntent(intentType));
  };

  const handleAddIntent = () => {
    if (tempIntent) {
      // Add the intent to the array - it will appear in the intents list below
      // The form card will disappear and the intent card will appear below with the same structure,
      // creating a visual "morph" effect
      onChange([...intents, tempIntent]);
      // Clear the form
      setSelectedIntentType("");
      setTempIntent(null);
    }
  };

  const updateTempIntent = (updates: Partial<Intent>) => {
    if (tempIntent) {
      setTempIntent({ ...tempIntent, ...updates });
    }
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
      required: false
    });
    onChange(updated);
  };

  const removeField = (intentIndex: number, fieldIndex: number) => {
    const updated = [...intents];
    if (updated[intentIndex].fields) {
      updated[intentIndex].fields = updated[intentIndex].fields!.filter((_, i) => i !== fieldIndex);
      onChange(updated);
    }
  };

  const updateField = (intentIndex: number, fieldIndex: number, updates: Partial<IntentField>) => {
    const updated = [...intents];
    if (updated[intentIndex].fields) {
      updated[intentIndex].fields![fieldIndex] = {
        ...updated[intentIndex].fields![fieldIndex],
        ...updates
      };
      onChange(updated);
    }
  };

  const addTempField = () => {
    if (tempIntent) {
      const updated = { ...tempIntent };
      if (!updated.fields) {
        updated.fields = [];
      }
      updated.fields.push({
        name: "",
        type: "string",
        required: false
      });
      setTempIntent(updated);
    }
  };

  const removeTempField = (fieldIndex: number) => {
    if (tempIntent && tempIntent.fields) {
      const updated = { ...tempIntent };
      updated.fields = updated.fields!.filter((_, i) => i !== fieldIndex);
      setTempIntent(updated);
    }
  };

  const updateTempField = (fieldIndex: number, updates: Partial<IntentField>) => {
    if (tempIntent && tempIntent.fields) {
      const updated = { ...tempIntent };
      updated.fields![fieldIndex] = {
        ...updated.fields![fieldIndex],
        ...updates
      };
      setTempIntent(updated);
    }
  };

  return (
    <div className="space-y-4">
      {/* Add Intent Type Chips */}
      {intents.length === 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {INTENT_TYPES.map(({ value, label }) => (
            <Badge
              key={value}
              variant="muted"
              className={cn(
                "cursor-pointer font-normal focus:ring-0 focus:ring-offset-0",
                selectedIntentType === value &&
                  "bg-primary dark:bg-accent border border-border text-primary-foreground dark:text-accent-foreground"
              )}
              onClick={() => handleChipClick(value)}
              role="button"
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleChipClick(value);
                }
              }}
            >
              {label}
            </Badge>
          ))}
        </div>
      )}

      {/* Form for Selected Intent Type */}
      {selectedIntentType && tempIntent && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {getIntentIcon(tempIntent.kind)}
                <CardTitle className="text-base capitalize">{tempIntent.kind.replace(/_/g, " ")}</CardTitle>
                {/* <CardDescription>{tempIntent.scope}</CardDescription> */}
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={handleAddIntent} className="h-8 w-8 p-0">
                  <Check className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedIntentType("");
                    setTempIntent(null);
                  }}
                  className="h-8 w-8 p-0"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Add Entity Form */}
            {tempIntent.kind === "add_entity" && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Entity Name</label>
                  <Input
                    value={tempIntent.entity || ""}
                    onChange={e => updateTempIntent({ entity: e.target.value })}
                    placeholder="e.g., User, Post"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Fields</label>
                    <Button variant="outline" size="sm" onClick={addTempField}>
                      <Plus className="w-4 h-4 mr-2" />
                      Add Field
                    </Button>
                  </div>
                  {tempIntent.fields?.map((field, fieldIndex) => (
                    <Card key={fieldIndex} className="p-3">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 grid grid-cols-2 gap-2">
                          <Input
                            placeholder="Field name"
                            value={field.name}
                            onChange={e =>
                              updateTempField(fieldIndex, {
                                name: e.target.value
                              })
                            }
                          />
                          <Select
                            value={field.type}
                            onValueChange={value =>
                              updateTempField(fieldIndex, {
                                type: value
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {FIELD_TYPES.map(type => (
                                <SelectItem key={type} value={type}>
                                  {type}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => removeTempField(fieldIndex)} className="ml-2">
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={field.required || false}
                            onChange={e =>
                              updateTempField(fieldIndex, {
                                required: e.target.checked
                              })
                            }
                          />
                          Required
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={field.unique || false}
                            onChange={e =>
                              updateTempField(fieldIndex, {
                                unique: e.target.checked
                              })
                            }
                          />
                          Unique
                        </label>
                      </div>
                      {field.type === "array" && (
                        <div className="mt-2">
                          <label className="text-sm font-medium">Array Type</label>
                          <Select
                            value={field.array_type || ""}
                            onValueChange={value =>
                              updateTempField(fieldIndex, {
                                array_type: value
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select array type" />
                            </SelectTrigger>
                            <SelectContent>
                              {ARRAY_TYPES.map(type => (
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
                          <label className="text-sm font-medium">Enum Values (comma-separated)</label>
                          <Input
                            placeholder="value1, value2, value3"
                            value={field.enum_values?.join(", ") || ""}
                            onChange={e =>
                              updateTempField(fieldIndex, {
                                enum_values: e.target.value
                                  .split(",")
                                  .map(v => v.trim())
                                  .filter(v => v)
                              })
                            }
                          />
                        </div>
                      )}
                      {(field.max_length !== undefined || field.default !== undefined) && (
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          {field.type === "string" && (
                            <div>
                              <label className="text-sm font-medium">Max Length</label>
                              <Input
                                type="number"
                                placeholder="255"
                                value={field.max_length || ""}
                                onChange={e =>
                                  updateTempField(fieldIndex, {
                                    max_length: e.target.value ? parseInt(e.target.value) : undefined
                                  })
                                }
                              />
                            </div>
                          )}
                          <div>
                            <label className="text-sm font-medium">Default Value</label>
                            <Input
                              placeholder="default"
                              value={field.default !== undefined ? String(field.default) : ""}
                              onChange={e =>
                                updateTempField(fieldIndex, {
                                  default: e.target.value || undefined
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

            {/* Add Field Form */}
            {tempIntent.kind === "add_field" && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Entity Name</label>
                  <Input
                    value={tempIntent.entity || ""}
                    onChange={e => updateTempIntent({ entity: e.target.value })}
                    placeholder="e.g., User"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Fields</label>
                    <Button variant="outline" size="sm" onClick={addTempField}>
                      <Plus className="w-4 h-4 mr-2" />
                      Add Field
                    </Button>
                  </div>
                  {tempIntent.fields?.map((field, fieldIndex) => (
                    <Card key={fieldIndex} className="p-3">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 grid grid-cols-2 gap-2">
                          <Input
                            placeholder="Field name"
                            value={field.name}
                            onChange={e =>
                              updateTempField(fieldIndex, {
                                name: e.target.value
                              })
                            }
                          />
                          <Select
                            value={field.type}
                            onValueChange={value =>
                              updateTempField(fieldIndex, {
                                type: value
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {FIELD_TYPES.map(type => (
                                <SelectItem key={type} value={type}>
                                  {type}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => removeTempField(fieldIndex)} className="ml-2">
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </>
            )}

            {/* Add Relation Form */}
            {tempIntent.kind === "add_relation" && tempIntent.relation && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Source Entity</label>
                  <Input
                    value={tempIntent.relation.source_entity || ""}
                    onChange={e =>
                      updateTempIntent({
                        relation: {
                          ...tempIntent.relation!,
                          source_entity: e.target.value
                        }
                      })
                    }
                    placeholder="e.g., User"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Target Entity</label>
                  <Input
                    value={tempIntent.relation.target_entity || ""}
                    onChange={e =>
                      updateTempIntent({
                        relation: {
                          ...tempIntent.relation!,
                          target_entity: e.target.value
                        }
                      })
                    }
                    placeholder="e.g., Post"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Relation Kind</label>
                  <Select
                    value={tempIntent.relation.kind || "one_to_many"}
                    onValueChange={value =>
                      updateTempIntent({
                        relation: {
                          ...tempIntent.relation!,
                          kind: value
                        }
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RELATION_KINDS.map(kind => (
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
                    value={tempIntent.relation.field_name || ""}
                    onChange={e =>
                      updateTempIntent({
                        relation: {
                          ...tempIntent.relation!,
                          field_name: e.target.value
                        }
                      })
                    }
                    placeholder="e.g., posts"
                  />
                </div>
              </>
            )}

            {/* Add Endpoint Form */}
            {tempIntent.kind === "add_endpoint" && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Method</label>
                    <Select
                      value={tempIntent.method || "GET"}
                      onValueChange={value => updateTempIntent({ method: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {HTTP_METHODS.map(method => (
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
                      value={tempIntent.path || ""}
                      onChange={e => updateTempIntent({ path: e.target.value })}
                      placeholder="e.g., /api/users"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Entity</label>
                  <Input
                    value={tempIntent.entity || ""}
                    onChange={e => updateTempIntent({ entity: e.target.value })}
                    placeholder="e.g., User"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Description</label>
                  <Input
                    value={tempIntent.description || ""}
                    onChange={e => updateTempIntent({ description: e.target.value })}
                    placeholder="Optional description"
                  />
                </div>
              </>
            )}

            {/* Add Capability Form */}
            {tempIntent.kind === "add_capability" && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Capability</label>
                  <Select
                    value={tempIntent.capability || "auth"}
                    onValueChange={value => updateTempIntent({ capability: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CAPABILITIES.map(cap => (
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
                    value={tempIntent.framework || ""}
                    onChange={e => updateTempIntent({ framework: e.target.value })}
                    placeholder="e.g., next-auth"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Provider</label>
                  <Input
                    value={tempIntent.provider || ""}
                    onChange={e => updateTempIntent({ provider: e.target.value })}
                    placeholder="e.g., google"
                  />
                </div>
              </>
            )}

            {/* <div className="flex justify-end pt-4 border-t border-border">
              <Button onClick={handleAddIntent} size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Add Intent
              </Button>
            </div> */}
          </CardContent>
        </Card>
      )}

      {/* Intents List */}
      <div className="space-y-4">
        {intents.map((intent, intentIndex) => (
          <Card key={intentIndex}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getIntentIcon(intent.kind)}
                  <CardTitle className="text-base">
                    {intent.kind === "add_endpoint" && intent.method && intent.path ? (
                      <>
                        <span className={cn("font-semibold", getMethodColor(intent.method))}>
                          {intent.method.toUpperCase()}
                        </span>
                        <span className="text-foreground ml-2"> {intent.path}</span>
                      </>
                    ) : (
                      toHumanReadable((intent.entity || intent.path || intent.capability || "Intent") as string)
                    )}
                  </CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  {intent.kind && <Badge variant="outline">{intent.kind}</Badge>}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-red-600 dark:text-red-400"
                        onClick={() => removeIntent(intentIndex)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              {intent.description && <CardDescription>{intent.description}</CardDescription>}
              {intent.kind === "add_capability" && (
                <CardDescription>{toHumanReadable(intent.provider || "")}</CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Add Entity */}
              {intent.kind === "add_entity" && (
                <>
                  {intent.fields && intent.fields.length > 0 && (
                    <div>
                      <div className="space-y-2">
                        {intent.fields.map((field, fieldIndex) => (
                          <div key={fieldIndex} className="border-l-2 border-muted pl-3 py-1">
                            <div className="flex items-center gap-2">
                              <span
                                className="text-xs font-medium"
                                style={{
                                  fontFamily: "Monospace"
                                }}
                              >
                                {field.name}
                              </span>
                              <span
                                className="text-xs text-blue-600 dark:text-blue-400"
                                style={{
                                  fontFamily: "Monospace"
                                }}
                              >
                                {field.type.toLowerCase()}
                              </span>
                              {field.name === "id" ? (
                                <Badge variant="muted" className="text-xs">
                                  PRIMARY KEY
                                </Badge>
                              ) : field.required ? (
                                <Badge variant="muted" className="text-xs">
                                  NOT NULL
                                </Badge>
                              ) : null}
                              {field.unique && (
                                <Badge variant="muted" className="text-xs">
                                  UNIQUE
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Add Field */}
              {intent.kind === "add_field" && (
                <>
                  {intent.entity && (
                    <div>
                      <span className="text-sm font-medium">Entity:</span>
                      <span className="ml-2 font-mono text-sm">{intent.entity}</span>
                    </div>
                  )}
                  {intent.fields && intent.fields.length > 0 && (
                    <div>
                      <span className="text-sm font-medium mb-2 block">Fields:</span>
                      <div className="space-y-2">
                        {intent.fields.map((field, fieldIndex) => (
                          <div key={fieldIndex} className="border-l-2 border-muted pl-3 py-1">
                            <div className="flex items-center gap-2">
                              <span
                                className="text-xs font-medium"
                                style={{
                                  fontFamily: "Monospace"
                                }}
                              >
                                {field.name}
                              </span>
                              <span
                                className="text-xs text-blue-600 dark:text-blue-400"
                                style={{
                                  fontFamily: "Monospace"
                                }}
                              >
                                {field.type.toLowerCase()}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Add Relation */}
              {intent.kind === "add_relation" && intent.relation && (
                <div className="space-y-2">
                  <div>
                    <span className="text-sm font-medium">Source:</span>
                    <span className="ml-2 font-mono text-sm">{intent.relation.source_entity}</span>
                  </div>
                  <div>
                    <span className="text-sm font-medium">Target:</span>
                    <span className="ml-2 font-mono text-sm">{intent.relation.target_entity}</span>
                  </div>
                  <div>
                    <span className="text-sm font-medium">Type:</span>
                    <Badge variant="outline" className="ml-2 text-xs">
                      {intent.relation.kind?.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  {intent.relation.field_name && (
                    <div>
                      <span className="text-sm font-medium">Field:</span>
                      <span className="ml-2 font-mono text-sm">{intent.relation.field_name}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Add Endpoint */}
              {intent.kind === "add_endpoint" && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Method</label>
                      <Select
                        value={intent.method || "GET"}
                        onValueChange={value => updateIntent(intentIndex, { method: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {HTTP_METHODS.map(method => (
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
                        onChange={e => updateIntent(intentIndex, { path: e.target.value })}
                        placeholder="/users"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Entity (optional)</label>
                    <Input
                      value={intent.entity || ""}
                      onChange={e => updateIntent(intentIndex, { entity: e.target.value })}
                      placeholder="e.g., User"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Description (optional)</label>
                    <Input
                      value={intent.description || ""}
                      onChange={e =>
                        updateIntent(intentIndex, {
                          description: e.target.value
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
                        onValueChange={value => updateIntent(intentIndex, { capability: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CAPABILITIES.map(cap => (
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
                        onChange={e =>
                          updateIntent(intentIndex, {
                            framework: e.target.value
                          })
                        }
                        placeholder="e.g., next, gin"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Provider (optional)</label>
                    <Input
                      value={intent.provider || ""}
                      onChange={e => updateIntent(intentIndex, { provider: e.target.value })}
                      placeholder="e.g., clerk, auth0"
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
