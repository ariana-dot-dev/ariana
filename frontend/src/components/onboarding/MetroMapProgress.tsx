import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Step {
  number: number;
  label: string;
}

interface MetroMapProgressProps {
  steps: Step[];
  currentStep: number;
}

export function MetroMapProgress({ steps, currentStep }: MetroMapProgressProps) {
  return (
    <div className="relative flex items-start justify-center gap-0 mb-6 md:mb-12 w-full max-w-md mx-auto">
      {steps.map((step, index) => {
        const isCompleted = step.number < currentStep;
        const isCurrent = step.number === currentStep;
        const isUpcoming = step.number > currentStep;

        return (
          <div key={step.number} className="relative flex flex-col items-center" style={{ flex: 1 }}>
            {/* Circle */}
            <div className='relative w-11 h-11 flex items-center justify-center'>
              <div className={cn(
                "absolute w-full h-full rounded-full animate-pulse",
                isCurrent && "bg-accent/50 [DELETED]backdrop-blur-lg z-10"
              )}>

              </div>
              <div
                className={cn(
                  "w-9 h-9 rounded-full z-20 flex items-center justify-center font-semibold text-sm transition-all shrink-0 relative",
                  isCompleted && "dark:bg-constructive bg-constructive-foreground dark:text-constructive-foreground text-constructive",
                  isCurrent && "bg-accent text-accent-foreground",
                  isUpcoming && "bg-background text-muted-foreground"
                )}
              >
                {isCompleted ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <span>{step.number == steps.length ? "🎉" : step.number}</span>
                )}
              </div>
            </div>

            {/* Label */}
            <span
              className={cn(
                "text-xs font-medium whitespace-nowrap mt-2",
                (isCompleted || isCurrent) && "text-foreground",
                isUpcoming && "text-muted-foreground"
              )}
            >
              {step.label}
            </span>

            {/* Connector Line - absolutely positioned from center of circle */}
            {index < steps.length - 1 && (
              <div
                className="absolute w-[88%] top-[1.2rem] h-1 z-0"
                style={{
                  left: 'calc(50% + 1rem)',
                  right: 'calc(-50% + 1rem)',
                }}
              >
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    isCompleted && "dark:bg-constructive bg-constructive-foreground",
                    (isCurrent || isUpcoming) && "bg-background"
                  )}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
