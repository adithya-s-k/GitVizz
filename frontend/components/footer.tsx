const Footer = () => {
    return (
        <footer className="relative z-10 border-t border-border/50 bg-background/80 backdrop-blur-sm mt-16">
            <div className="max-w-7xl mx-auto px-6 py-8">
                <div className="text-center space-y-4">
                    <p className="text-sm text-muted-foreground">
                        &copy; {new Date().getFullYear()} GitViz - From Repo to Reasoning — Instantly.
                    </p>
                    <div className="flex items-center justify-center gap-6">
                        <a
                            href="https://github.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                            GitHub
                        </a>
                        <a
                            href="https://nextjs.org"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Next.js
                        </a>
                    </div>
                </div>
            </div>
        </footer>
    )
}

export default Footer