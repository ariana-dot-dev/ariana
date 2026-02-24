import * as React from 'react';
import { cn } from '@/lib/utils';

interface SelectGroupContextValue {
  value: string;
  onChange: (value: string) => void;
  orientation: 'vertical' | 'horizontal';
  inverted: boolean;
  rounded: boolean;
}

const SelectGroupContext = React.createContext<SelectGroupContextValue | undefined>(undefined);

function useSelectGroup() {
  const context = React.useContext(SelectGroupContext);
  if (!context) {
    throw new Error('SelectGroupOption must be used within SelectGroup');
  }
  return context;
}

interface SelectGroupPositionContextValue {
  isFirst: boolean;
  isLast: boolean;
}

const SelectGroupPositionContext = React.createContext<SelectGroupPositionContextValue | undefined>(undefined);

interface SelectGroupProps {
  value: string;
  onValueChange: (value: string) => void;
  orientation?: 'vertical' | 'horizontal';
  rounded?: boolean;
  inverted?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function SelectGroupRoot({ value, onValueChange, children, className, orientation = 'vertical', inverted = false, rounded = true }: SelectGroupProps) {
  const childArray = React.Children.toArray(children);

  return (
    <SelectGroupContext.Provider value={{ value, onChange: onValueChange, orientation, inverted, rounded }}>
      <div className={cn(
        "p-0.5",
        rounded ? 'rounded-[1rem]' : 'rounded-lg',
        inverted ? 'dark:bg-background-darker bg-lightest' : 'bg-muted/20 dark:bg-muted/30',
        orientation === 'vertical' ? 'flex flex-col' : 'flex flex-row', className
      )}>
        {childArray.map((child, index) => (
          <SelectGroupPositionContext.Provider
            key={index}
            value={{
              isFirst: index === 0,
              isLast: index === childArray.length - 1
            }}
          >
            {child}
          </SelectGroupPositionContext.Provider>
        ))}
      </div>
    </SelectGroupContext.Provider>
  );
}

interface SelectGroupOptionProps {
  value: string;
  disabled?: boolean;
  children: React.ReactNode;
  inverted?: boolean;
  className?: string;
  onClick?: () => void;
}

export const SelectGroupOption = React.forwardRef<HTMLButtonElement, SelectGroupOptionProps>(
  ({ value, disabled = false, children, className, onClick }, ref) => {
    const { value: selectedValue, onChange, orientation, inverted, rounded } = useSelectGroup();
    const position = React.useContext(SelectGroupPositionContext);
    const isSelected = selectedValue === value;
    const isFirst = position?.isFirst;
    const isLast = position?.isLast;
    const isHorizontal = orientation === 'horizontal';

    function handleClick() {
      if (!disabled) {
        onChange(value);
        onClick?.();
      }
    }

    return (
          <button
            ref={ref}
            type="button"
            disabled={disabled}
            onClick={handleClick}
          className={cn(
            'inline-flex items-center justify-center text-sm transition-all disabled:pointer-events-none disabled:!bg-background-darker disabled:!text-muted-foreground/50',
            'focus:outline-none focus:ring-0 h-4',
            rounded ? 'rounded-[0.85rem]' : 'rounded-md',
            isHorizontal ? (
              cn(
                'w-auto px-3 py-1',
                isFirst && (rounded ? 'rounded-l-[0.85rem]' : 'rounded-l-md'),
                isLast && (rounded ? 'rounded-r-[0.85rem]' : 'rounded-r-md'),
                !isFirst && !isLast && (rounded ? 'rounded-[0.85rem]' : 'rounded-md')
              )
            ) : (
              cn(
                'w-full flex-col items-start h-fit justify-start gap-2 text-left px-4 py-2',
                isFirst && (rounded ? 'rounded-t-[0.85rem]' : 'rounded-t-md'),
                isLast && (rounded ? 'rounded-b-[0.85rem]' : 'rounded-b-md'),
                !isFirst && !isLast && (rounded ? 'rounded-[0.85rem]' : 'rounded-md')
              )
            ),
            isSelected
              ? (
                inverted ? 'bg-muted/20 text-muted-foreground  dark:bg-background  dark:text-lightest' : 'bg-lightest text-muted-foreground dark:bg-background-darker  dark:text-lightest'
              )
              : 'text-muted-foreground/70 ',
            disabled ? 'opacity-50' : '',
            className
          )}
        >
          {children}
        </button>
    );
  }
);

SelectGroupOption.displayName = 'SelectGroupOption';
