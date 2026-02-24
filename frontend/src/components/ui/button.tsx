import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group rounded-md disabled:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-background-darker",
        background: "bg-background",
        muted: "bg-muted",
        destructive: "bg-destructive",
        constructive: "bg-constructive",
        caution: "dark:bg-amber-600/80 bg-amber-200/80",
        accent: "bg-accent",
        transparent: "bg-transparent",
      },
      size: {
        default: "",
        sm: "",
        lg: "",
        icon: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const buttonInnerVariants = cva(
  "p-[var(--border-width)] rounded-md",
  {
    variants: {
      variant: {
        default: "bg-gradient-to-t from-darkest/5 to-lightest/30 dark:from-darkest/30 dark:to-lightest/5",
        background: "bg-gradient-to-t from-background/5 to-lightest/30 dark:from-background/30 dark:to-lightest/5",
        muted: "bg-gradient-to-t from-muted/5 to-lightest/30 dark:from-muted/30 dark:to-lightest/5",
        destructive: "bg-gradient-to-t from-darkest/10 to-lightest/40 dark:from-darkest/40 dark:to-lightest/10",
        constructive: "bg-gradient-to-t from-darkest/10 to-lightest/40 dark:from-darkest/40 dark:to-lightest/10",
        caution: "bg-gradient-to-t from-darkest/10 to-lightest/40 dark:from-darkest/40 dark:to-lightest/10",
        accent: "bg-gradient-to-t from-darkest/10 to-lightest/40 dark:from-darkest/40 dark:to-lightest/10",
        transparent: "bg-transparent",
      },
    },
  }
)

const buttonContentVariants = cva(
  "inline-flex items-center justify-center gap-2 outline-none whitespace-nowrap rounded-md text-sm disabled:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-background-darker text-muted-foreground",
        background: "bg-background text-muted-foreground",
        muted: "bg-muted text-muted-foreground",
        destructive: "bg-destructive text-destructive-foreground",
        constructive: "bg-constructive text-constructive-foreground",
        caution: "dark:bg-amber-600/80 bg-amber-200/80 text-foreground",
        accent: "bg-accent text-accent-foreground",
        transparent: "bg-transparent text-muted-foreground group-hover:text-accent",
      },
      size: {
        default: "px-4 py-2",
        sm: "px-3 py-1",
        lg: "px-8 py-3",
        icon: "h-7 w-7",
      },
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  hoverVariant?: "default" | "background" | "muted" | "destructive" | "constructive" | "caution" | "accent" | "transparent"
  animateHeight?: boolean
  animateScale?: boolean
  animateRight?: boolean
  wFull?: boolean
  hFull?: boolean
  textLeft?: boolean
  lock?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, hoverVariant, size, animateHeight = false, animateScale = false, animateRight = false, asChild = false, wFull = false, hFull = false, textLeft = false, lock = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    const [isHovered, setIsHovered] = React.useState(false)
    const activeVariant = isHovered && hoverVariant && !disabled && !lock ? hoverVariant : variant

    if (!size) {
      size = "default"
    }

    if (asChild) {
      return (
        <Slot
          ref={ref}
          className={cn(
            buttonVariants({ variant: activeVariant, size, className }),
            !disabled && !lock && [
              animateHeight && "hover:-translate-y-[2px]",
              animateScale && "hover:scale-[1.01]",
              animateRight && "hover:translate-x-[2px]"
            ],
            wFull ? "w-full" : "w-fit",
            hFull ? "h-full" : "h-fit"
          )}
          {...props}
        >
          {children}
        </Slot>
      )
    }

    return (
      <div
        className={cn(
          buttonVariants({ variant: (lock ? variant : activeVariant), size }),
          !disabled && !lock && [
            animateHeight && "hover:-translate-y-[2px]",
            animateScale && "hover:scale-[1.01]",
            animateRight && "hover:translate-x-[2px]"
          ],
          disabled && "pointer-events-none opacity-40",
            wFull ? "w-full" : "w-fit",
            hFull ? "h-full" : "h-fit"
        )}
        onMouseEnter={() => !disabled && !lock && setIsHovered(true)}
        onMouseLeave={() => !disabled && !lock && setIsHovered(false)}
      >
        <div className={cn(
          buttonInnerVariants({ variant: (lock ? variant : activeVariant) }),
            wFull ? "w-full" : "w-fit",
            hFull ? "h-full" : "h-fit"
        )}>
          <Comp
            ref={ref}
            className={cn(
              buttonContentVariants({ variant: (lock ? variant : activeVariant), size, className }),
              wFull && size !== "icon" ? "w-full" : "",
              hFull && size !== "icon" ? "h-full" : "",
              textLeft && "justify-start"
            )}
            {...props}
          >
            {children}
          </Comp>
        </div>
      </div>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }