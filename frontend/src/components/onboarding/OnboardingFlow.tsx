import { MetroMapProgress } from './MetroMapProgress';
import { OnboardingProvider } from './OnboardingProvider';
import { useAppStore } from '@/stores/useAppStore';
import { CustomHeader } from '@/components/CustomHeader';

const ONBOARDING_STEPS = [
  { number: 1, label: 'Agent Provider' },
  { number: 2, label: 'Plans' },
  { number: 3, label: 'Use Ariana' }
];

export function OnboardingFlow() {
  const hasCompletedOnboarding = useAppStore(state => state.hasCompletedOnboarding);

  // Onboarding is always step 1 (provider setup) when shown
  const currentStep = 1;

  // If onboarding complete, don't render
  if (hasCompletedOnboarding) {
    return null;
  }

  return (
    <div className="h-screen flex flex-col justify-center md:p-0 p-3.5">
      <CustomHeader />
      <div className="flex flex-col items-center md:justify-center md:pb-20 md:pt-0 pt-10 h-full">
        {/* Metro Map Progress */}
        <MetroMapProgress steps={ONBOARDING_STEPS} currentStep={currentStep} />

        {/* Step Content */}
        <div className="w-md max-w-full h-[67%] flex flex-col ">
          <OnboardingProvider />
        </div>
      </div>
    </div>
  );
}
