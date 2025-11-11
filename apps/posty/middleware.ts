import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  
  // Public routes that don't require authentication
  const publicRoutes = [
    "/api/auth",      // Authentication endpoints
    "/api/routes",    // API routes metadata
    "/api/schema",    // Database schema metadata
  ];
  
  // Check if the current path is a public route
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));
  
  // Protect all /api routes except public routes
  if (pathname.startsWith("/api") && !isPublicRoute) {
    // Check if user is authenticated
    // req.auth is populated by the auth() wrapper from NextAuth v5
    if (!req.auth) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Match all API routes
     * Next.js middleware matcher uses path-to-regexp syntax
     * This will match /api/* but the function logic excludes /api/auth/*
     */
    "/api/:path*",
  ],
};

