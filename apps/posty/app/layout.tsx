import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Posty",
  description: "A simple application built with Next.js and Prisma"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
