import "./globals.css";

export const metadata = { title: "todo", description: "No auth, integer keys, enums, decimals, a one-to-one profile, set-null deletes and a composite-key junction." };

// Appearance: system (follows the OS; the dark class is applied before first paint). Set backend_options.appearance in .osl/config.yaml before the first osl generate, or edit this file; OSL never rewrites it.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning style={{ "--font-sans": "ui-sans-serif, system-ui, sans-serif" } as React.CSSProperties}>
      <head>
        <meta name="color-scheme" content="light dark" />
        <script dangerouslySetInnerHTML={{ __html: "(function(){var m=window.matchMedia('(prefers-color-scheme: dark)');function apply(){document.documentElement.classList.toggle('dark',m.matches)}apply();m.addEventListener('change',apply)})();" }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
