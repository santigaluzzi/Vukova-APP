import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vukova Administración",
  description: "Núcleo administrativo multisede de Vukova.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
