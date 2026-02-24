import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { DropdownMenuItem } from "./dropdown-menu-item"
import CheckmarkCircle from "./icons/CheckmarkCircle"

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
  )
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  )
}

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> & {
    sideOffset?: number
  }
>(({ className, sideOffset = 4, ...props }, ref) => {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "bg-background-darker flex flex-col gap-0.5 mx-2 text-foreground-darker data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md p-1",
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
})
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

function DropdownMenuGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return (
    <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  )
}


function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(
        "focus:bg-secondary cursor-pointer focus:text-muted-foreground relative flex items-center gap-2 rounded-sm py-1.5 pl-2 pr-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      checked={checked}
      {...props}
    >
      {children}
      <span className="pointer-events-none absolute right-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <div className="h-4 w-4">
            <CheckmarkCircle className="max-w-full max-h-full text-accent" />
          </div>
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return (
    <DropdownMenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        "focus:bg-secondary cursor-pointer focus:text-muted-foreground relative flex items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-2 py-1.5 text-sm font-medium data-[inset]:pl-8",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("border-muted/50 border-dashed -mx-1 mt-2 mb-1 h-[1px] border-b-(length:--border-width)", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "text-muted-foreground ml-auto text-xs tracking-widest",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
}

const dropdownMenuSubTriggerVariants = cva(
  "rounded-md w-full transition-all cursor-pointer data-[disabled]:opacity-60 data-[disabled]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-background-darker data-[state=open]:bg-background-darker hover:bg-background-darker",
        destructive: "bg-destructive data-[state=open]:bg-destructive/90 hover:bg-destructive/90",
        constructive: "bg-constructive data-[state=open]:bg-constructive/90 hover:bg-constructive/90",
        accent: "bg-accent data-[state=open]:bg-accent/90 hover:bg-accent/90",
        transparent: "bg-transparent data-[state=open]:bg-secondary/50 hover:bg-secondary/50",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const dropdownMenuSubTriggerInnerVariants = cva(
  "p-[var(--border-width)] w-full rounded-md transition-all",
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

const dropdownMenuSubTriggerContentVariants = cva(
  "relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-all outline-hidden select-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-background-darker text-muted-foreground focus:bg-background-darker data-[state=open]:bg-background-darker",
        destructive: "bg-destructive text-destructive-foreground focus:bg-destructive/90 data-[state=open]:bg-destructive/90",
        constructive: "bg-constructive text-constructive-foreground focus:bg-constructive/90 data-[state=open]:bg-constructive/90",
        accent: "bg-accent text-accent-foreground focus:bg-accent/90 data-[state=open]:bg-accent/90",
        transparent: "bg-transparent text-muted-foreground focus:bg-secondary/50 data-[state=open]:bg-secondary/50",
      },
    },
  }
)

interface DropdownMenuSubTriggerProps
  extends React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>,
    VariantProps<typeof dropdownMenuSubTriggerVariants> {
  inset?: boolean
  hoverVariant?: "default" | "destructive" | "constructive" | "accent" | "transparent"
}

function DropdownMenuSubTrigger({
  className,
  variant = "default",
  hoverVariant,
  inset,
  children,
  disabled,
  ...props
}: DropdownMenuSubTriggerProps) {
  const [isHovered, setIsHovered] = React.useState(false)
  const [isOpen, setIsOpen] = React.useState(false)
  const activeVariant = disabled ? "default" : ((isHovered || isOpen) && hoverVariant ? hoverVariant : variant)

  return (
    <div
      className={cn(
        dropdownMenuSubTriggerVariants({ variant: activeVariant }),
        inset && "ml-6"
      )}
      data-disabled={disabled || undefined}
      onMouseEnter={() => !disabled && setIsHovered(true)}
      onMouseLeave={() => !disabled && setIsHovered(false)}
    >
      <div className={cn(dropdownMenuSubTriggerInnerVariants({ variant: activeVariant }))}>
        <DropdownMenuPrimitive.SubTrigger
          data-slot="dropdown-menu-sub-trigger"
          data-inset={inset}
          className={cn(
            dropdownMenuSubTriggerContentVariants({ variant: activeVariant }),
            className
          )}
          disabled={disabled}
          onPointerEnter={(e) => {
            setIsOpen(true)
            props.onPointerEnter?.(e)
          }}
          onPointerLeave={(e) => {
            setIsOpen(false)
            props.onPointerLeave?.(e)
          }}
          {...props}
        >
          {children}
          <ChevronRightIcon className="ml-auto size-4" />
        </DropdownMenuPrimitive.SubTrigger>
      </div>
    </div>
  )
}

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => {
  return (
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      data-slot="dropdown-menu-sub-content"
      className={cn(
        "bg-background-darker flex flex-col gap-0.5 mx-2 text-foreground-darker data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden rounded-md p-1",
        className
      )}
      {...props}
    />
  )
})
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
