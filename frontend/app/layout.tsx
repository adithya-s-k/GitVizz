import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { ResultDataProvider } from "@/context/ResultDataContext";
import { ToasterProvider } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GitViz - From Repo to Reasoning Instantly",
  description:
    "GitViz helps you understand repository content easily and extract AI-ready plain text from GitHub or local files.",
  keywords: [
    "GitViz",
    "GitHub Visualization",
    "Repo to Text",
    "Code to Text",
    "AI Ready Code",
    "GitHub Summary Tool",
    "Repository Analysis",
    "Code Understanding",
    "Plain Text Conversion",
  ],
  authors: [{ name: "GitViz Team", url: "https://gitviz.app" }],
  metadataBase: new URL("https://gitviz.app"), //FIXME: replace with actual domain
  openGraph: {
    title: "GitViz - From Repo to Reasoning Instantly",
    description:
      "Visualize and extract code structure effortlessly. Convert repositories to AI-friendly plain text with GitViz.",
    url: "https://gitviz.app", //FIXME: replace with actual domain
    siteName: "GitViz",
    images: [
      {
        url: "../public/og-image.png",
        width: 1200,
        height: 630,
        alt: "GitViz - From Repo to Reasoning Instantly",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "GitViz - From Repo to Reasoning Instantly",
    description:
      "Understand GitHub repositories visually and convert them into AI-ready formats.",
    creator: "@yourhandle", // FIXME: Replace with Twitter handle
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ToasterProvider>
          <Providers>
            <ResultDataProvider>{children}</ResultDataProvider>
          </Providers>
        </ToasterProvider>
      </body>
    </html>
  );
}