import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Outreach", template: "%s — Outreach" },
  description: "B2B cold outreach platforma za lokalne biznise u Srbiji.",
};

// Pre-paint tema: izbegava FOUC pri dark mode toggle-u.
const prePaintTheme = `(function(){try{if(localStorage.getItem("app_theme")==="dark"){document.documentElement.classList.add("dark")}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sr" className={`${inter.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: prePaintTheme }} />
      </head>
      <body className="min-h-full bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
