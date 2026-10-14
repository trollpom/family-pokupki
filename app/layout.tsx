import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {width: "device-width", initialScale: 1, themeColor: "#315d45"};

export const metadata: Metadata = {
  title: "Собрано — покупки с хорошим планом",
  description: "Недельное меню для семьи, рецепты DeepSeek, список покупок и расчёт бюджета.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Собрано" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/icon-192.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
