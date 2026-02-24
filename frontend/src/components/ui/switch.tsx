import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const switchVariants = cva(
  "peer data-[state=checked]:bg-accent/50 data-[state=unchecked]:bg-lightest focus-visible:border-muted focus-visible:ring-muted/50 dark:data-[state=unchecked]:bg-darkest inline-flex shrink-0 items-center rounded-full border-(length:--border-width) border-transparent shadow-xs transition-all outline-none disabled:cursor-not-allowed disabled:opacity-50 p-0",
  {
    variants: {
      size: {
        default: "h-[1.15rem] w-8",
        sm: "h-[0.9rem] w-6",
        xs: "h-[0.7rem] w-5",
        lg: "h-[1.4rem] w-10",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

const switchThumbVariants = cva(
  "data-[state=unchecked]:bg-muted/50 data-[state=checked]:bg-background dark:data-[state=unchecked]:bg-muted dark:data-[state=checked]:bg-muted-foreground pointer-events-none block rounded-full ring-0 transition-transform data-[state=unchecked]:translate-x-0 h-full aspect-square",
  {
    variants: {
      size: {
        default: "data-[state=checked]:translate-x-[calc(2rem-1.15rem)]",
        sm: "data-[state=checked]:translate-x-[calc(1.5rem-0.9rem)]",
        xs: "data-[state=checked]:translate-x-[calc(1.25rem-0.7rem)]",
        lg: "data-[state=checked]:translate-x-[calc(2.5rem-1.4rem)]",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

export interface SwitchProps
  extends React.ComponentProps<typeof SwitchPrimitive.Root>,
    VariantProps<typeof switchVariants> {}

function Switch({
  className,
  size,
  ...props
}: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(switchVariants({ size }), className)}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(switchThumbVariants({ size }))}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
