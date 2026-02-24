import { Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAppStore } from "@/stores/useAppStore"

export function ThemeToggle() {
  const { setTheme, theme } = useAppStore()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="default" size="icon" className="w-8 h-8 text-muted-foreground">
          <Sun className="h-6 w-6 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
          <Moon className="absolute h-6 w-6 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem variant="default" hoverVariant="accent" disabled={theme === 'light'} onClick={() => setTheme("light")}>
          Light
        </DropdownMenuItem>
        <DropdownMenuItem variant="default" hoverVariant="accent" disabled={theme === 'dark'} onClick={() => setTheme("dark")}>
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem variant="default" hoverVariant="accent" disabled={theme === 'system'} onClick={() => setTheme("system")}>
          System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}