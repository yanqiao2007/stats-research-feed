import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "STATS Research Feed",
  description: "Your personalized research inbox for organizational and I/O psychology.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        {/*
          Wraps the whole app because the magic-link landing page at
          /auth/confirm needs the same auth context the feed does. When no
          Supabase project is configured the provider resolves immediately to
          "unconfigured" and makes no network calls, so the localStorage-only
          experience is unchanged.
        */}
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
