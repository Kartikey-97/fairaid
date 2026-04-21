import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";
import { AppChrome } from "@/components/navigation/AppChrome";

import "./globals.css";

const uiFont = Manrope({
  subsets: ["latin"],
  variable: "--font-ui",
  display: "swap",
});

const displayFont = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FairAid | Smart & Fair Volunteer Allocation",
  description:
    "FairAid helps NGOs post urgent and non-urgent needs and route the right volunteers fairly.",
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`h-full antialiased ${uiFont.variable} ${displayFont.variable}`}>
      <body className="min-h-full bg-[var(--bg)] text-[var(--text)]">
        <AppChrome>
          {children}
        </AppChrome>
      </body>
    </html>
  );
}
