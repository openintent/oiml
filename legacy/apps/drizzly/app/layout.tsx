export const metadata = { title: "drizzly", description: "OSL sample app using Drizzle ORM" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
