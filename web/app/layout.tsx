import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, JetBrains_Mono, Outfit } from "next/font/google";
import "./globals.css";

const display = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const ui = Outfit({
  variable: "--font-ui",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Sharebook",
  description: "Custom voice alarms, clock, timer, notes, and to-dos",
  applicationName: "Sharebook",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Sharebook",
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f2ee" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0b0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full overflow-x-hidden bg-[var(--background)] font-sans text-[var(--foreground)] transition-colors duration-300 selection:bg-brand-200 selection:text-brand-900 dark:selection:bg-brand-800 dark:selection:text-brand-50">
        {children}
      </body>
    </html>
  );
}
