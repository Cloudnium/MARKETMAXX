import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/shared/AuthProvider";
import { EstadoRed } from "@/components/shared/EstadoRed";
import { SedeProvider } from "@/components/shared/SedeProvider";

export const metadata: Metadata = {
  title: "Cloudnium Market",
  description: "Sistema de gestión de ventas e inventario",
  icons: { icon: "/favicon.ico", shortcut: "/favicon.ico", apple: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <AuthProvider>
          <EstadoRed />
          <SedeProvider>{children}</SedeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
