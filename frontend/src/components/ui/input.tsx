import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, roundedFull, ...props }: React.ComponentProps<"input"> & { roundedFull?: boolean }) {
  return (
    <div className="bg-background-darker rounded-md">
      <div className="p-[var(--border-width)] rounded-md bg-gradient-to-b from-darkest/5 to-lightest/30 dark:from-darkest/30 dark:to-lightest/5">
        <input
          type={type}
          data-slot="input"
          spellCheck="false"
          className={cn(
            "text-muted-foreground placeholder:text-muted-foreground/50 rounded-md flex h-9 w-full min-w-0 bg-background-darker px-3 py-1 text-base transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:bg-background-darker file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            roundedFull ? 'rounded-full' : 'rounded-md',
            className
          )}
          {...props}
        />
      </div>
    </div>
  )
}

export { Input }
