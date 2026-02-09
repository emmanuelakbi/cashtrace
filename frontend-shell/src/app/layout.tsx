import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CashTrace - SME Cashflow & Compliance Copilot",
  description:
    "CashTrace helps Nigerian small businesses manage cashflow, track transactions, and stay compliant.",
  openGraph: {
    title: "CashTrace",
    description: "SME Cashflow & Compliance Copilot for Nigerian businesses",
    type: "website",
    locale: "en_NG",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#2e7d32",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
