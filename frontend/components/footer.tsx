import { Github,Globe } from "lucide-react";

const Footer = () => {
    return (
        <footer className="relative z-10 border-t border-border/50 bg-background/80 backdrop-blur-sm mt-16">
            <div className="max-w-7xl mx-auto px-6 py-8">
                <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                    {/* Left: Primary links */}
                    <div className="flex items-center gap-6 mb-2 md:mb-0">
                        <a
                            href="https://github.com/adithya-s-k/GitViz"
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="GitHub Repository"
                            className="flex items-center gap-2 text-sm font-semibold text-foreground hover:underline transition-colors"
                        >
                            <Github className="text-lg" />
                            Repo
                        </a>
                        <a
                            href="https://cognitivelab.in"
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Cognitivelab Website"
                            className="flex items-center gap-2 text-sm font-semibold text-foreground hover:underline transition-colors"
                        >
                            <Globe className="text-lg" />
                            Website
                        </a>
                    </div>
                    {/* Divider for larger screens */}
                    <div className="hidden md:block h-6 border-l border-border/30 mx-4" />
                    {/* Right: Attribution */}
                    <div className="text-xs text-muted-foreground text-center md:text-right">
                        Made by{" "}
                        <a
                            href="https://cognitivelab.in"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:text-foreground"
                        >
                            Cognitivelab
                        </a>{" "}
                        (powered by <span className="font-semibold">omnibarse</span>)
                    </div>
                </div>
                <p className="text-center text-sm text-muted-foreground mt-4">
                    &copy; {new Date().getFullYear()} GitViz - From Repo to Reasoning — Instantly.
                </p>
            </div>
        </footer>
    )
}

export default Footer