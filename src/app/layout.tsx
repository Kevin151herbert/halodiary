import type { Metadata } from "next";
// Fonts are self-hosted from our own domain (no Google Fonts round trip), two weights plus one variable face.
import "@fontsource/atkinson-hyperlegible/latin-400.css";
import "@fontsource/atkinson-hyperlegible/latin-700.css";
import "@fontsource-variable/bricolage-grotesque/wght.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "HaloDiary: your recurring services, on autopilot",
  description:
    "Cleaning, tutoring, dog walking, car servicing and more, scheduled, confirmed and paid with PayPal under one monthly budget. An AI assistant handles the rest.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
