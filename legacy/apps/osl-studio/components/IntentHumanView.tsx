import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Database, Code, Zap, FileText, MoreVertical, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

interface IntentHumanViewProps {
  intentData: any;
  onDeleteIntent?: (index: number) => void;
}

export function IntentHumanView({ intentData, onDeleteIntent }: IntentHumanViewProps) {
  if (!intentData) return null;

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

    // Handle snake_case and kebab-case
    let result = str.replace(/[_-]/g, " ");

    // Handle camelCase - add space before capital letters
    result = result.replace(/([a-z])([A-Z])/g, "$1 $2");

    // Split into words and capitalize each
    const words = result.split(/\s+/);
    const capitalized = words.map(word => {
      // Handle special cases like "email" -> "E-mail"
      if (word.toLowerCase() === "email") {
        return "E-mail";
      }
      // Capitalize first letter
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });

    return capitalized.join(" ");
  };

  const getScopeColor = (scope: string) => {
    switch (scope) {
      case "data":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "api":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "capability":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
      case "ui":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
    }
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

  const formatFieldType = (type: string) => {
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  return (
    <div className="space-y-6">
      {/* Header Info */}
      {/* <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">Intent Specification</h3>
          {intentData.version && (
            <Badge variant="outline" className="text-xs">
              v{intentData.version}
            </Badge>
          )}
        </div>
        {intentData.type && (
          <p className="text-sm text-muted-foreground">{intentData.type}</p>
        )}
      </div> */}

      {/* Provenance */}
      {/* {intentData.provenance && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Provenance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {intentData.provenance.created_by && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Created by:</span>
                <span className="font-medium">
                  {intentData.provenance.created_by.name ||
                    intentData.provenance.created_by.type}
                </span>
                {intentData.provenance.created_by.type && (
                  <Badge variant="outline" className="text-xs">
                    {intentData.provenance.created_by.type}
                  </Badge>
                )}
              </div>
            )}
            {intentData.provenance.created_at && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Created at:</span>
                <span>
                  {new Date(intentData.provenance.created_at).toLocaleString()}
                </span>
              </div>
            )}
            {intentData.provenance.model && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Model:</span>
                <span className="font-medium">
                  {intentData.provenance.model}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )} */}

      {/* AI Context */}
      {/* {intentData.ai_context && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI Context</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {intentData.ai_context.purpose && (
              <div>
                <span className="text-sm font-medium">Purpose:</span>
                <p className="text-sm text-muted-foreground mt-1">
                  {intentData.ai_context.purpose}
                </p>
              </div>
            )}
            {intentData.ai_context.instructions && (
              <div>
                <span className="text-sm font-medium">Instructions:</span>
                <pre className="text-xs bg-muted p-3 rounded-md mt-1 whitespace-pre-wrap">
                  {intentData.ai_context.instructions}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )} */}

      {/* Intents */}
      {intentData.intents && intentData.intents.length > 0 && (
        <div className="space-y-4">
          {/* <h3 className="text-lg font-semibold">Intents</h3> */}
          {intentData.intents.map((intent: any, index: number) => (
            <Card key={index}>
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
                        toHumanReadable(intent.entity || intent.path || intent.capability || "Intent")
                      )}
                    </CardTitle>
                  </div>
                  <div className="flex items-center gap-2">
                    {intent.kind && <Badge variant="outline">{intent.kind}</Badge>}
                    {onDeleteIntent && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-red-600 dark:text-red-400"
                            onClick={() => onDeleteIntent(index)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
                {intent.description && <CardDescription>{intent.description}</CardDescription>}
                {intent.kind === "add_capability" && (
                  <CardDescription>{toHumanReadable(intent.provider)}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Add Entity */}
                {intent.kind === "add_entity" && (
                  <>
                    {/* {intent.entity && (
                      <div>
                        <span className="text-sm font-medium">Entity:</span>
                        <span className="ml-2 font-mono text-sm">
                          {intent.entity}
                        </span>
                      </div>
                    )} */}
                    {intent.fields && intent.fields.length > 0 && (
                      <div>
                        {/* <span className="text-sm font-medium mb-2 block">Fields:</span> */}
                        <div className="space-y-2">
                          {intent.fields.map((field: any, fieldIndex: number) => (
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
                                {field.isPrimary || field.primary || field.name === "id" ? (
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
                              {/* <div className="flex flex-wrap gap-2 mt-1">
                                  {field.max_length && (
                                    <span className="text-xs text-muted-foreground">
                                      Max length: {field.max_length}
                                    </span>
                                  )}
                                  {field.default !== undefined && (
                                    <span className="text-xs text-muted-foreground">
                                      Default: {String(field.default)}
                                    </span>
                                  )}
                                </div> */}
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
                          {intent.fields.map((field: any, fieldIndex: number) => (
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
                {/* {intent.kind === "add_endpoint" && (
                  <div className="space-y-2">
                    {intent.entity && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground font-medium">
                          Entity:
                        </span>
                        <code className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
                          {intent.entity}
                        </code>
                      </div>
                    )}
                    {intent.description && (
                      <div className="text-sm text-muted-foreground">
                        {intent.description}
                      </div>
                    )}
                  </div>
                )} */}

                {/* Add Capability */}
                {/* {intent.kind === "add_capability" && (
                  <div className="space-y-2">
                    {intent.framework && (
                      <div>
                        <span className="text-sm font-medium">Framework:</span>
                        <span className="ml-2 font-mono text-sm">{intent.framework}</span>
                      </div>
                    )}
                    {intent.provider && (
                      <div>
                        <span className="text-sm font-medium">Provider:</span>
                        <span className="ml-2 font-mono text-sm">{toHumanReadable(intent.provider)}</span>
                      </div>
                    )}
                  </div>
                )} */}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
