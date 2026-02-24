import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const dropdownMenuItemVariants = cva(
  "rounded-md w-full  cursor-pointer data-[disabled]:opacity-60 data-[disabled]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-background-darker data-[highlighted]:bg-background-darker",
        destructive: "bg-destructive data-[highlighted]:bg-destructive/90",
        constructive: "bg-constructive data-[highlighted]:bg-constructive/90",
        accent: "bg-accent data-[highlighted]:bg-accent/90",
        transparent: "bg-transparent data-[highlighted]:bg-secondary/50",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const dropdownMenuItemInnerVariants = cva(
  "p-[var(--border-width)] w-full rounded-md ",
  {
    variants: {
      variant: {
        default: "bg-gradient-to-t from-darkest/5 to-lightest/30 dark:from-darkest/30 dark:to-lightest/5",
        destructive: "bg-gradient-to-t from-darkest/10 to-lightest/40 dark:from-darkest/40 dark:to-lightest/10",
        constructive: "bg-gradient-to-t from-darkest/10 to-lightest/40 dark:from-darkest/40 dark:to-lightest/10",
        accent: "bg-gradient-to-t from-darkest/10 to-lightest/40 dark:from-darkest/40 dark:to-lightest/10",
        transparent: "bg-transparent",
      },
    },
  }
)

const dropdownMenuItemContentVariants = cva(
  "relative flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm  outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:!bg-background-darker data-[disabled]:!text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-background-darker text-muted-foreground focus:bg-background-darker data-[highlighted]:bg-background-darker",
        destructive: "bg-destructive text-destructive-foreground focus:bg-destructive/90 data-[highlighted]:bg-destructive/90",
        constructive: "bg-constructive text-constructive-foreground focus:bg-constructive/90 data-[highlighted]:bg-constructive/90",
        accent: "bg-accent text-accent-foreground focus:bg-accent/90 data-[highlighted]:bg-accent/90",
        transparent: "bg-transparent text-muted-foreground focus:bg-secondary/50 data-[highlighted]:bg-secondary/50",
      },
    },
  }
)

export interface DropdownMenuItemProps
  extends React.ComponentProps<typeof DropdownMenuPrimitive.Item>,
    VariantProps<typeof dropdownMenuItemVariants> {
  inset?: boolean
  hoverVariant?: "default" | "destructive" | "constructive" | "accent" | "transparent"
  animateHeight?: boolean
}

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  DropdownMenuItemProps
>(({ className, variant, hoverVariant, animateHeight = false, inset, children, disabled, ...props }, ref) => {
  const [isHovered, setIsHovered] = React.useState(false)
  const [isHighlighted, setIsHighlighted] = React.useState(false)
  const activeVariant = disabled ? "default" : ((isHovered || isHighlighted) && hoverVariant ? hoverVariant : variant)

  const handleHighlight = React.useCallback(() => !disabled && setIsHighlighted(true), [disabled])
  const handleUnhighlight = React.useCallback(() => !disabled && setIsHighlighted(false), [disabled])

  return (
    <div
      className={cn(
        dropdownMenuItemVariants({ variant: activeVariant }),
        animateHeight && !disabled && "hover:-translate-y-[2px]",
        inset && "ml-6"
      )}
      data-highlighted={isHighlighted || undefined}
      data-disabled={disabled || undefined}
      onMouseEnter={() => !disabled && setIsHovered(true)}
      onMouseLeave={() => !disabled && setIsHovered(false)}
    >
      <div className={cn(dropdownMenuItemInnerVariants({ variant: activeVariant }))}>
        <DropdownMenuPrimitive.Item
          ref={ref}
          className={cn(
            dropdownMenuItemContentVariants({ variant: activeVariant }),
            className
          )}
          disabled={disabled}
          onFocus={handleHighlight}
          onBlur={handleUnhighlight}
          onPointerEnter={handleHighlight}
          onPointerLeave={handleUnhighlight}
          {...props}
        >
          {children}
        </DropdownMenuPrimitive.Item>
      </div>
    </div>
  )
})
DropdownMenuItem.displayName = "DropdownMenuItem"

export { DropdownMenuItem }