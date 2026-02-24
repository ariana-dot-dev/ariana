import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"
import { useIsTouchDevice } from "@/hooks/useIsTouchDevice"

// Utility to compose multiple refs
function composeRefs<T>(...refs: (React.Ref<T> | undefined)[]): React.RefCallback<T> {
  return (node: T) => {
    refs.forEach((ref) => {
      if (!ref) return;
      if (typeof ref === 'function') {
        ref(node);
      } else {
        (ref as React.MutableRefObject<T>).current = node;
      }
    });
  };
}

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const [open, setOpen] = React.useState(false)
  const isTouchDevice = useIsTouchDevice()
  const contentRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLElement>(null)
  const openedAtRef = React.useRef<number>(0)

  // Close tooltip when clicking/tapping outside
  React.useEffect(() => {
    if (!isTouchDevice || !open) return

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node

      // Check if click is outside both trigger and content
      if (
        triggerRef.current &&
        contentRef.current &&
        !triggerRef.current.contains(target) &&
        !contentRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }

    // Use timeout to avoid closing immediately after opening
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('touchstart', handleClickOutside)
    }, 100)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [isTouchDevice, open])

  const handleTouchStart = React.useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (isTouchDevice) {
      e.preventDefault()
      e.stopPropagation()

      const now = Date.now()
      const timeSinceOpened = now - openedAtRef.current

      if (open && timeSinceOpened < 1000) {
        // Prevent closing if opened less than 1 second ago
        return
      }

      if (!open) {
        openedAtRef.current = now
      }

      setOpen(prev => !prev)
    }
  }, [isTouchDevice, open])

  return (
    <TooltipProvider>
      <TooltipPrimitive.Root
        data-slot="tooltip"
        open={isTouchDevice ? open : undefined}
        onOpenChange={isTouchDevice ? setOpen : undefined}
        {...props}
      >
        {React.Children.map(children, (child) => {
          if (React.isValidElement(child)) {
            if (child.type === TooltipTrigger) {
              const childProps: any = isTouchDevice ? {
                onClick: handleTouchStart,
                onTouchStart: handleTouchStart,
              } : {};

              // Compose refs if on touch device
              if (isTouchDevice) {
                const childRef = (child as any).ref;
                childProps.ref = composeRefs(triggerRef, childRef);
              }

              return React.cloneElement(
                child as React.ReactElement<any>,
                childProps
              )
            }
            if (child.type === TooltipContent) {
              return React.cloneElement(
                child as React.ReactElement<any>,
                { contentRef }
              )
            }
          }
          return child
        })}
      </TooltipPrimitive.Root>
    </TooltipProvider>
  )
}

const TooltipTrigger = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Trigger>,
  React.ComponentProps<typeof TooltipPrimitive.Trigger>
>(({ ...props }, ref) => {
  return <TooltipPrimitive.Trigger ref={ref} data-slot="tooltip-trigger" {...props} />
})
TooltipTrigger.displayName = "TooltipTrigger"

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  contentRef,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  contentRef?: React.RefObject<HTMLDivElement>
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={contentRef as any}
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "bg-background-darker m-0.5 max-w-[45ch] text-foreground border-(length:--border-width) border-muted/30 animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-4 py-3 text-sm text-balance leading-relaxed",
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="bg-background-darker fill-background-darker border-b-(length:--border-width) border-r-(length:--border-width) border-muted/30 z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
