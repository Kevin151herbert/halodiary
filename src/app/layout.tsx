import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HaloDiary: your recurring services, on autopilot",
  description:
    "Cleaning, tutoring, dog walking, car servicing and more, scheduled, confirmed and paid with PayPal under one monthly budget. An AI assistant handles the rest.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&display=swap"
        />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
