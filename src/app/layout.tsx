import type { Metadata } from "next";
// Fonts are self-hosted from our own domain (no Google Fonts round trip), two weights plus one variable face.
import "@fontsource/atkinson-hyperlegible/latin-400.css";
import "@fontsource/atkinson-hyperlegible/latin-700.css";
import "@fontsource-variable/inter/wght.css";
import "./globals.css";
import { BootScreen } from "./boot-screen";

export const metadata: Metadata = {
  title: "HaloDiary: your recurring services, on autopilot",
  description:
    "Cleaning, tutoring, dog walking, car servicing and more, scheduled, confirmed and paid with PayPal under one monthly budget. An AI assistant handles the rest.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The boot screen script marks <html> as booted before React hydrates, hence the suppressed warning.
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh">
        <BootScreen />
        {children}
      </body>
    </html>
  );
}
