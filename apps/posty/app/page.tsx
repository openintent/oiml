"use client";

import { useEffect, useState } from "react";
import { Key, LogOut, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

export default function Home() {
  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<{
    email: string;
    first_name: string | null;
    last_name: string | null;
  } | null>(null);

  // Login form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  // Main app state
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
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  // Check authentication status on mount
  useEffect(() => {
    async function checkAuth() {
      try {
        const response = await fetch("/api/auth/session");
        if (response.ok) {
          const data = await response.json();
          if (data.user) {
            setIsAuthenticated(true);
            setUser(data.user);
          }
        }
      } catch (err) {
        console.error("Error checking auth:", err);
      } finally {
        setAuthLoading(false);
      }
    }

    checkAuth();
  }, []);

  // Fetch data only when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;

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
  }, [isAuthenticated]);

  // Handle login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Login failed");
      }

      setIsAuthenticated(true);
      setUser(data.data);
      setEmail("");
      setPassword("");
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoginLoading(false);
    }
  };

  // Handle logout
  const handleLogout = async () => {
    try {
      await fetch("/api/auth/signout", { method: "POST" });
      setIsAuthenticated(false);
      setUser(null);
      setModels([]);
      setEndpoints([]);
    } catch (err) {
      console.error("Error logging out:", err);
    }
  };

  // Extract parameter names from endpoint path (e.g., [id], [userId])
  const getEndpointParams = (path: string): string[] => {
    const matches = path.match(/\[([^\]]+)\]/g);
    return matches ? matches.map((match) => match.slice(1, -1)) : [];
  };

  // Replace parameters in path with actual values
  const buildEndpointPath = (
    path: string,
    params: Record<string, string>
  ): string => {
    let builtPath = path;
    Object.entries(params).forEach(([key, value]) => {
      builtPath = builtPath.replace(`[${key}]`, value);
    });
    return builtPath;
  };

  const handleEndpointClick = async (endpoint: ApiEndpoint) => {
    if (endpoint.method !== "GET") {
      return;
    }

    const params = getEndpointParams(endpoint.path);

    // If endpoint has parameters, just select it and wait for form submission
    if (params.length > 0) {
      setSelectedEndpoint(endpoint);
      setApiResponse(null);
      setApiError(null);
      // Initialize param values
      const initialParams: Record<string, string> = {};
      params.forEach((param) => {
        initialParams[param] = "";
      });
      setParamValues(initialParams);
      return;
    }

    // For non-parameterized endpoints, fetch immediately
    setSelectedEndpoint(endpoint);
    setApiLoading(true);
    setApiError(null);
    setApiResponse(null);

    try {
      const response = await fetch(endpoint.path);
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

  const handleSubmitParams = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEndpoint) return;

    const params = getEndpointParams(selectedEndpoint.path);

    // Validate all params are filled
    const missingParams = params.filter((param) => !paramValues[param]?.trim());
    if (missingParams.length > 0) {
      setApiError(`Please fill in all parameters: ${missingParams.join(", ")}`);
      return;
    }

    setApiLoading(true);
    setApiError(null);
    setApiResponse(null);

    try {
      const path = buildEndpointPath(selectedEndpoint.path, paramValues);
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

  // Show loading state while checking auth
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-mono dark:bg-black">
        <div className="text-zinc-600 dark:text-zinc-400">Loading...</div>
      </div>
    );
  }

  // Show login form if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-mono dark:bg-black p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-2xl">Login to Posty</CardTitle>
            <CardDescription>
              Enter your credentials to access the API dashboard
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {loginError && (
                <div className="text-sm text-destructive">{loginError}</div>
              )}
              <Button type="submit" className="w-full" disabled={loginLoading}>
                {loginLoading ? "Logging in..." : "Login"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-mono dark:bg-black">
      <main className="flex flex-col min-h-screen w-full max-w-6xl items-start justify-start p-8 sm:p-16 bg-white dark:bg-black">
        <div className="w-full space-y-12">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold mb-2 text-black dark:text-white">
                Posty
              </h1>
              <p className="text-zinc-600 dark:text-zinc-400">
                Database Schema & API Overview
              </p>
            </div>
            <div className="flex items-center gap-4">
              {user && (
                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                  {user.first_name} {user.last_name}
                </span>
              )}
              <Button variant="outline" size="sm" onClick={handleLogout}>
                <LogOut className="w-4 h-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="text-zinc-600 dark:text-zinc-400">
              Loading schema and API routes...
            </div>
          ) : error ? (
            <div className="text-red-600 dark:text-red-400">Error: {error}</div>
          ) : (
            <>
              {/* Prisma Schema Section */}
              <section className="w-full">
                <h2 className="text-2xl font-semibold mb-4 text-black dark:text-white border-b border-zinc-200 dark:border-zinc-800 pb-2">
                  Schema
                </h2>
                <div className="grid gap-6 md:grid-cols-2">
                  {models.map((model) => (
                    <div
                      key={model.name}
                      className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-6 bg-zinc-50 dark:bg-zinc-900"
                    >
                      <div className="mb-4">
                        <h3 className="text-xl font-semibold text-black dark:text-white">
                          {model.name}
                        </h3>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                          Table:{" "}
                          <code className="bg-zinc-200 dark:bg-zinc-800 px-2 py-1 rounded">
                            {model.tableName}
                          </code>
                        </p>
                      </div>
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                          Fields:
                        </h4>
                        <ul className="space-y-2">
                          {model.fields.map((field) => (
                            <li key={field.name} className="text-sm">
                              <span className="font-medium text-black dark:text-white">
                                {field.name}:
                              </span>{" "}
                              <span className="text-zinc-600 dark:text-zinc-400">
                                {field.type}
                              </span>
                              {field.attributes?.some(
                                (attr) =>
                                  attr.includes("@id") || attr.includes("id")
                              ) && (
                                <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                                  <KeyRound className="w-3 h-3" />
                                  <span>PK</span>
                                </span>
                              )}
                              {field.foreignKey && (
                                <span className="ml-2 inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
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
                <h2 className="text-2xl font-semibold mb-4 text-black dark:text-white border-b border-zinc-200 dark:border-zinc-800 pb-2">
                  API Endpoints
                </h2>
                <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-zinc-50 dark:bg-zinc-900">
                  <table className="w-full">
                    <thead className="bg-zinc-100 dark:bg-zinc-800">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
                          Method
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
                          Path
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
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
                            className={`hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                              endpoint.method === "GET"
                                ? "cursor-pointer transition-colors"
                                : "cursor-default"
                            } ${
                              selectedEndpoint &&
                              selectedEndpoint.method === endpoint.method &&
                              selectedEndpoint.path === endpoint.path &&
                              endpoint.method === "GET"
                                ? "bg-blue-50 dark:bg-blue-950"
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
                                    : "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
                                }`}
                              >
                                {endpoint.method}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <code className="text-sm text-black dark:text-white">
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
                  <div className="mt-6 border border-zinc-200 dark:border-zinc-800 rounded-lg bg-zinc-50 dark:bg-zinc-900 p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-black dark:text-white">
                        {selectedEndpoint.method}{" "}
                        {selectedEndpoint.path.replace(/\/$/, "")}
                      </h3>
                      <button
                        onClick={() => {
                          setSelectedEndpoint(null);
                          setApiResponse(null);
                          setApiError(null);
                          setParamValues({});
                        }}
                        className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                      >
                        Close
                      </button>
                    </div>

                    {/* Parameter Form */}
                    {getEndpointParams(selectedEndpoint.path).length > 0 && (
                      <form onSubmit={handleSubmitParams} className="mb-6">
                        <div className="space-y-4">
                          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                            Parameters:
                          </h4>
                          {getEndpointParams(selectedEndpoint.path).map(
                            (param) => (
                              <div key={param} className="flex flex-col gap-2">
                                <Label htmlFor={param}>{param}</Label>
                                <Input
                                  type="text"
                                  id={param}
                                  value={paramValues[param] || ""}
                                  onChange={(e) =>
                                    setParamValues({
                                      ...paramValues,
                                      [param]: e.target.value,
                                    })
                                  }
                                  placeholder={`Enter ${param}`}
                                />
                              </div>
                            )
                          )}
                          <Button type="submit" disabled={apiLoading}>
                            {apiLoading ? "Loading..." : "Submit"}
                          </Button>
                        </div>
                      </form>
                    )}

                    {/* Response Display */}
                    {apiLoading &&
                    getEndpointParams(selectedEndpoint.path).length === 0 ? (
                      <div className="text-zinc-600 dark:text-zinc-400">
                        Loading...
                      </div>
                    ) : apiError ? (
                      <div className="text-red-600 dark:text-red-400">
                        Error: {apiError}
                      </div>
                    ) : apiResponse ? (
                      <div>
                        <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                          Response:
                        </h4>
                        <pre className="bg-black dark:bg-zinc-950 text-green-400 p-4 rounded-lg overflow-x-auto text-sm font-mono">
                          {JSON.stringify(apiResponse, null, 2)}
                        </pre>
                      </div>
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
