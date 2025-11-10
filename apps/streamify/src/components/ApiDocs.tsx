"use client";

import { useEffect, useState } from "react";
import { Key } from "lucide-react";

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

interface ApiEndpoint {
  method: string;
  path: string;
  description: string;
}

export default function ApiDocs() {
  const [models, setModels] = useState<Model[]>([]);
  const [endpoints, setEndpoints] = useState<ApiEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiResponse, setApiResponse] = useState<unknown>(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [selectedEndpoint, setSelectedEndpoint] = useState<ApiEndpoint | null>(
    null
  );

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);

        // Fetch schema models
        const schemaResponse = await fetch("/api/schema");
        const schemaData = await schemaResponse.json();

        if (schemaData.models) {
          setModels(schemaData.models);
        } else {
          throw new Error(schemaData.error || "Failed to fetch schema");
        }

        // Fetch API endpoints
        const routesResponse = await fetch("/api/routes");
        const routesData = await routesResponse.json();

        if (routesData.endpoints) {
          // Filter out internal endpoints used for generating this page
          const filteredEndpoints = routesData.endpoints.filter(
            (endpoint: ApiEndpoint) =>
              endpoint.path !== "/api/routes" && endpoint.path !== "/api/schema"
          );
          setEndpoints(filteredEndpoints);
        } else {
          throw new Error(routesData.error || "Failed to fetch routes");
        }

        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
        console.error("Error fetching data:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const handleEndpointClick = async (endpoint: ApiEndpoint) => {
    if (endpoint.method !== "GET") {
      return;
    }

    setSelectedEndpoint(endpoint);
    setApiLoading(true);
    setApiError(null);
    setApiResponse(null);

    try {
      // Replace :id with a placeholder or handle it differently
      let path = endpoint.path;
      // For demo purposes, we'll try to call endpoints without IDs
      // or skip endpoints that require IDs
      if (path.includes(":id")) {
        setApiError("This endpoint requires an ID parameter");
        setApiLoading(false);
        return;
      }

      const response = await fetch(path);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      setApiResponse(data);
    } catch (err) {
      setApiError(
        err instanceof Error ? err.message : "Failed to fetch endpoint"
      );
      console.error("Error fetching endpoint:", err);
    } finally {
      setApiLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-mono">
      <main className="flex flex-col min-h-screen w-full max-w-6xl mx-auto items-start justify-start p-8 sm:p-16">
        <div className="w-full space-y-12">
          <div>
            <h1 className="text-4xl font-bold mb-2">Streamify</h1>
            <p className="text-muted-foreground">
              Database Schema & API Overview
            </p>
          </div>

          {loading ? (
            <div className="text-muted-foreground">
              Loading schema and API routes...
            </div>
          ) : error ? (
            <div className="text-destructive">Error: {error}</div>
          ) : (
            <>
              {/* Schema Section */}
              <section className="w-full">
                <h2 className="text-2xl font-semibold mb-4 border-b border-border pb-2">
                  Schema
                </h2>
                <div className="grid gap-6 md:grid-cols-2">
                  {models.map((model) => (
                    <div
                      key={model.name}
                      className="border border-border rounded-lg p-6 bg-card"
                    >
                      <div className="mb-4">
                        <h3 className="text-xl font-semibold">{model.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          Table:{" "}
                          <code className="bg-muted px-2 py-1 rounded">
                            {model.tableName}
                          </code>
                        </p>
                      </div>
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium">Fields:</h4>
                        <ul className="space-y-2">
                          {model.fields.map((field) => (
                            <li key={field.name} className="text-sm">
                              <span className="font-medium">{field.name}:</span>{" "}
                              <span className="text-muted-foreground">
                                {field.type}
                              </span>
                              {field.foreignKey && (
                                <span className="ml-2 inline-flex items-center gap-1 text-xs text-primary">
                                  <Key className="w-3 h-3" />
                                  <span>
                                    {field.foreignKey.targetEntity}.
                                    {field.foreignKey.targetField}
                                  </span>
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* API Endpoints Section */}
              <section className="w-full">
                <h2 className="text-2xl font-semibold mb-4 border-b border-border pb-2">
                  API Endpoints
                </h2>
                <div className="border border-border rounded-lg overflow-hidden bg-card">
                  <table className="w-full">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">
                          Method
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">
                          Path
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {endpoints
                        .filter(
                          (endpoint) =>
                            !endpoint.path.includes("/api/routes") &&
                            !endpoint.path.includes("/api/schema")
                        )
                        .map((endpoint, idx) => (
                          <tr
                            key={idx}
                            onClick={() => handleEndpointClick(endpoint)}
                            className={`hover:bg-accent ${
                              endpoint.method === "GET"
                                ? "cursor-pointer transition-colors"
                                : "cursor-default"
                            } ${
                              selectedEndpoint &&
                              selectedEndpoint.method === endpoint.method &&
                              selectedEndpoint.path === endpoint.path &&
                              endpoint.method === "GET"
                                ? "bg-primary/10"
                                : ""
                            }`}
                          >
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span
                                className={`inline-flex px-2 py-1 text-xs font-semibold rounded ${
                                  endpoint.method === "GET"
                                    ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                                    : endpoint.method === "POST"
                                      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                                      : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {endpoint.method}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <code className="text-sm">
                                {endpoint.path.replace(/\/$/, "")}
                              </code>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>

                {/* API Response Display */}
                {selectedEndpoint && (
                  <div className="mt-6 border border-border rounded-lg bg-card p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold">
                        Response: {selectedEndpoint.method}{" "}
                        {selectedEndpoint.path.replace(/\/$/, "")}
                      </h3>
                      <button
                        onClick={() => {
                          setSelectedEndpoint(null);
                          setApiResponse(null);
                          setApiError(null);
                        }}
                        className="text-sm text-muted-foreground hover:text-foreground"
                      >
                        Close
                      </button>
                    </div>

                    {apiLoading ? (
                      <div className="text-muted-foreground">Loading...</div>
                    ) : apiError ? (
                      <div className="text-destructive">Error: {apiError}</div>
                    ) : apiResponse ? (
                      <pre className="bg-black text-green-400 p-4 rounded-lg overflow-x-auto text-sm font-mono">
                        {JSON.stringify(apiResponse, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

