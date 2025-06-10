"use client";

import { useResultData } from "@/context/ResultDataContext";
import { useEffect } from "react";
import Image from "next/image";
import Logo from "@/public/logo.svg";

// Custom Components
import ThemeToggle from "@/components/theme-toggle";
import { RepoTabs } from "@/components/repo-tabs";
import { showToast } from "@/components/ui/toaster";
import Footer from "@/components/footer";


export default function Home() {
  const { error, outputMessage, setError, setOutputMessage } = useResultData();

  useEffect(() => {
    if (error) {
      showToast.error(error);
      setError(""); // Clear error after showing
    }
  }, [error]);

  useEffect(() => {
    if (outputMessage) {
      showToast.success(outputMessage);
      setOutputMessage(""); // Clear message after showing
    }
  }, [outputMessage]);

  return (
    <div className="min-h-screen bg-background">
      {/* Visual Anchor - Top Gradient */}
      <div className="fixed top-0 left-0 right-0 h-96 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />

      {/* Floating Theme Toggle */}
      <ThemeToggle />

      {/* Header */}
      <header className="relative z-10 pt-12 pb-8">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center space-y-6">
            {/* Logo and Brand */}
            <div className="flex items-center justify-center gap-3 mb-6">
              <div className="p-3 bg-primary/10 rounded-2xl backdrop-blur-sm">
                <Image
                  src={Logo}
                  alt="GitViz"
                  width={44}
                  height={44}
                  className="h-11 w-11"
                  priority
                />
              </div>
              <div className="text-left">
                <h1 className="text-3xl font-bold tracking-tight">GitViz</h1>
                <p className="text-sm text-muted-foreground">From Repo to Reasoning — Instantly.</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-5xl mx-auto px-6 pb-16">
        <RepoTabs />
      </main>

      {/* Visual Anchor - Bottom Gradient */}
      <div className="fixed bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-primary/5 to-transparent pointer-events-none" />

      {/* Footer */}
      <Footer />
    </div>
  );
}
