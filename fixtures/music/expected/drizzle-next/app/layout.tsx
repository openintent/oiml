import "./globals.css";

export const metadata = { title: "music", description: "A music catalog. Albums hold tracks in an order the server keeps, tracks have genres through a junction, and listeners order the tracks of their playlists." };

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
