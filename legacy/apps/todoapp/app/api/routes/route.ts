import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

interface ApiEndpoint {
  method: string;
  path: string;
  description: string;
}

export async function GET() {
  try {
    const apiDir = path.join(process.cwd(), "app", "api");
    const endpoints: ApiEndpoint[] = [];

    // Recursively scan API directory
    function scanDirectory(dir: string, basePath: string = "/api") {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const routePath = path.join(basePath, entry.name);

        if (entry.isDirectory()) {
          // Recursively scan subdirectories
          scanDirectory(fullPath, routePath);
        } else if (entry.name === "route.ts") {
          // Read route file to determine HTTP methods
          const routeContent = fs.readFileSync(fullPath, "utf-8");

          // Extract HTTP methods
          const methods = ["GET", "POST", "PATCH", "PUT", "DELETE"].filter(method =>
            routeContent.includes(`export async function ${method}`)
          );

          // Create endpoint for each method
          for (const method of methods) {
            let description = `${method} ${routePath
              .replace(/\\/g, "/")
              .replace(/route\.ts$/, "")
              .replace(/\[.*?\]/g, ":id")}`;

            // Try to extract description from JSDoc or inline comments
            const jsdocMatch = routeContent.match(
              new RegExp(`/\\*\\*[\\s\\S]*?\\*/[\\s\\S]*?export async function ${method}`, "i")
            );
            if (jsdocMatch) {
              const jsdoc = jsdocMatch[0];
              const descMatch = jsdoc.match(/\\*\\s+(.+?)(?:\\n|$)/);
              if (descMatch) {
                description = descMatch[1].trim();
              }
            } else {
              // Try inline comment on same or previous line
              const inlineMatch = routeContent.match(
                new RegExp(
                  `(?://\\s*(.+?)\\n|export async function ${method}\\s*\\([^)]*\\)\\s*{[^}]*//\\s*(.+?)(?:\\n|\\}))`,
                  "i"
                )
              );
              if (inlineMatch) {
                description = (inlineMatch[1] || inlineMatch[2] || "").trim() || description;
              }
            }

            // Generate a default description based on method and path
            if (description === method) {
              const pathParts = routePath.split("/").filter(Boolean);
              const resource = pathParts[pathParts.length - 1]?.replace("route.ts", "") || "resource";
              const action =
                method === "GET"
                  ? "Fetch"
                  : method === "POST"
                    ? "Create"
                    : method === "PATCH"
                      ? "Update"
                      : method === "DELETE"
                        ? "Delete"
                        : "Handle";
              description = `${action} ${resource}`;
            }

            endpoints.push({
              method,
              path: routePath.replace(/\\/g, "/").replace(/route\.ts$/, ""),
              description
            });
          }
        }
      }
    }

    if (fs.existsSync(apiDir)) {
      scanDirectory(apiDir);
    }

    // Sort endpoints by path, then by method
    endpoints.sort((a, b) => {
      if (a.path !== b.path) {
        return a.path.localeCompare(b.path);
      }
      return a.method.localeCompare(b.method);
    });

    return NextResponse.json({ endpoints }, { status: 200 });
  } catch (error) {
    console.error("Error scanning API routes:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to scan routes"
      },
      { status: 500 }
    );
  }
}
