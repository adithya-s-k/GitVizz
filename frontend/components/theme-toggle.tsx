import React from 'react'
import { useTheme } from "next-themes"

import { Switch } from "@/components/ui/switch"
import { Sun, Moon } from "lucide-react"

const ThemeToggle = () => {
  const { theme, setTheme } = useTheme()

  if (theme !== "light" && theme !== "dark") {
    setTheme("light")
  }

  return (
    <div className="fixed top-6 right-6 z-50">
      <div className="flex items-center gap-2 bg-background/90 backdrop-blur-xl rounded-2xl px-4 py-2 border border-border/60 shadow-md">
        <Sun className="h-4 w-4 text-muted-foreground" />
        <Switch checked={theme === "dark"} onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")} />
        <Moon className="h-4 w-4 text-muted-foreground" />
      </div>
    </div>
  )
}

export default ThemeToggle