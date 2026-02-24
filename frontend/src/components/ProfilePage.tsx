import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { API_URL } from '@/config';
import { authenticatedFetch } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, ArrowLeft, Copy, Check } from 'lucide-react';
import { CustomHeader } from './CustomHeader';
import { routerService } from '@/services/router.service';
import { useUserSubscription, type UserSubscription } from '@/hooks/useUserSubscription';
import Logo from './ui/logo';
import StarFace from './ui/icons/StarFace';
import HappyFace from './ui/icons/HappyFace';
import KidFace from './ui/icons/KidFace';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useIsBrowser } from '@/hooks/useIsBrowser';

interface SubscriptionPlan {
  id: string;
  label: string;
  stripePriceId: string | null;
  limits: {
    maxProjectsTotal: number;
    maxAgentsPerMonth: number;
    maxSpecificationsTotal: number;
  } | null;
}

interface PricingCardProps {
  plan: SubscriptionPlan;
  currentPlanId: string | null;
  onSubscribe: (planId: string) => void;
  loading: boolean;
}

function PricingCard({ plan, currentPlanId, onSubscribe, loading }: PricingCardProps) {
  const isCurrentPlan = currentPlanId === plan.id;
  const isFree = plan.id === 'free';

  const planDetails: Record<string, { price: string; description: string }> = {
    free: {
      price: '$0',
      description: 'Usage limits enough to try the app',
    },
    max: {
      price: '$4.99/month',
      description: '10x more than Free.',
    },
    ultra: {
      price: '$45/month',
      description: '100x more than Free and priority support channel with the founders',
    },
  };

  const details = planDetails[plan.id] || { price: 'N/A', description: '' };

  const getPlanIcon = () => {
    switch (plan.id) {
      case 'free':
        return <KidFace className="max-w-full max-h-full backdrop-blur-md rounded-full text-inherit" />;
      case 'max':
        return <HappyFace className="max-w-full max-h-full backdrop-blur-md rounded-full text-inherit" />;
      case 'ultra':
        return <StarFace className="max-w-full max-h-full backdrop-blur-md rounded-full text-inherit" />;
      default:
        return null;
    }
  };

  return (
    <div
      className="relative overflow-hidden bg-muted/30 border border-border min-h-[200px] md:h-[250px] flex flex-col rounded-xl p-4"
      style={plan.id === 'max' ? {
        backgroundImage: 'url(/background6-smaller.png)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundBlendMode: 'overlay'
      } : undefined}
    >
      {plan.id === 'max' && (
        <div className="absolute inset-0 bg-background/75 pointer-events-none" />
      )}
      <div className="flex items-center justify-between mb-3 relative z-10">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10">
            {getPlanIcon()}
          </div>
          <div className="text-lg font-semibold">{plan.label.replace(' Plan', '')}</div>
        </div>
        {isCurrentPlan ? (
          <Badge variant="default" className="text-xs">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Current
          </Badge>
        ) : plan.id === 'max' && (
          <Badge variant="secondary" className="text-xs bg-accent/20 backdrop-blur-md text-accent">
            Best Value
          </Badge>
        )}
      </div>
      <div className="text-2xl font-bold text-foreground mb-3 relative z-10">
        {details.price}
      </div>
      <div className="flex-1 relative z-10">
        <p className="text-sm text-muted-foreground">
          {plan.id === 'max' && <span className="text-accent font-semibold">10x</span>}
          {plan.id === 'ultra' && <span className={`font-semibold ${currentPlanId !== 'free' && currentPlanId !== null ? 'text-accent' : ''}`}>100x</span>}
          {plan.id === 'max' ? ' more than Free, perfect for your average daily use.' : plan.id === 'ultra' ? ' more than Free, unlocking near unlimited use! + priority support channel with the founders' : details.description}
        </p>
      </div>
      {!isFree && !isCurrentPlan && (
        <div className="w-full mt-4 relative z-10">
          <Button 
              wFull
            size="default"
            onClick={() => onSubscribe(plan.id)}
            disabled={loading}
            variant={plan.id === 'max' && (currentPlanId === 'free' || !currentPlanId) ? 'accent' : 'default'}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              'Get'
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

export function ProfilePage() {
  const user = useAppStore(state => state.user);
  const { subscription, loading: subscriptionLoading, refetch } = useUserSubscription();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [copiedCheckoutUrl, setCopiedCheckoutUrl] = useState(false);
  const isBrowser = useIsBrowser();

  useEffect(() => {
    console.log('[ProfilePage] Subscription data:', subscription);
  }, [subscription]);

  // Define plans directly - no need to fetch from backend
  const plans: SubscriptionPlan[] = [
    {
      id: 'free',
      label: 'Free Plan',
      stripePriceId: null,
      limits: null,
    },
    {
      id: 'max',
      label: 'Max Plan',
      stripePriceId: 'price_max',
      limits: {
        maxProjectsTotal: 10,
        maxAgentsPerMonth: 100,
        maxSpecificationsTotal: 50,
      },
    },
    {
      id: 'ultra',
      label: 'Ultra Plan',
      stripePriceId: 'price_ultra',
      limits: {
        maxProjectsTotal: -1,
        maxAgentsPerMonth: -1,
        maxSpecificationsTotal: -1,
      },
    },
  ];

  const loading = subscriptionLoading;

  const handleCancelSubscription = async () => {
    if (!user) return;

    // Show confirmation dialog
    const confirmed = window.confirm(
      'Are you sure you want to cancel your subscription? You will be downgraded to the Free plan immediately.'
    );

    if (!confirmed) return;

    try {
      setCancelLoading(true);

      const response = await authenticatedFetch(`${API_URL}/api/stripe/subscription/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (data.success) {
        console.log('[ProfilePage] Subscription cancelled successfully');

        // Show cancellation message with date if available
        if (data.cancelAt) {
          const cancelDate = new Date(data.cancelAt).toLocaleDateString();
          alert(`Your subscription has been cancelled. You will retain access to your current plan until ${cancelDate}.`);
        } else {
          alert(data.message || 'Your subscription has been cancelled.');
        }

        // Refresh subscription data
        await refetch();
      } else {
        console.error('[ProfilePage] Failed to cancel subscription:', data.error);
        alert(`Failed to cancel subscription: ${data.error}`);
      }
    } catch (error) {
      console.error('[ProfilePage] Error cancelling subscription:', error);
      alert('An error occurred while cancelling your subscription. Please try again.');
    } finally {
      setCancelLoading(false);
    }
  };

  const handleSubscribe = async (planId: string) => {
    if (!user) return;

    try {
      setCheckoutLoading(true);

      // Create Stripe checkout session
      const response = await authenticatedFetch(`${API_URL}/api/stripe/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subscriptionPlanId: planId,
        }),
      });

      const data = await response.json();

      if (data.success && data.url) {
        // Store URL for iOS Safari fallback (popup blocked after async)
        setCheckoutUrl(data.url);

        // Open Stripe checkout in browser
        if (isBrowser) {
          window.open(data.url, '_blank');
        } else {
          await openUrl(data.url);
        }
      } else {
        console.error('[ProfilePage] Failed to create checkout session:', data.error);
      }
    } catch (error) {
      console.error('[ProfilePage] Error creating checkout session:', error);
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleCopyCheckoutUrl = async () => {
    if (!checkoutUrl) return;
    try {
      await navigator.clipboard.writeText(checkoutUrl);
      setCopiedCheckoutUrl(true);
      setTimeout(() => setCopiedCheckoutUrl(false), 2000);
    } catch (err) {
      console.error('Failed to copy checkout URL:', err);
    }
  };

  if (!user) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground">
        <Logo className='w-16 h-16 mr-6'/>
        <div className="text-muted-foreground">Please <a href="/app/auth" className='text-accent'>log in</a> to view your profile</div>
      </div>
    );
  }

  return (
      <div className="relative w-full h-full z-10 flex flex-col">
        <CustomHeader />

        <div className="flex-1 overflow-y-auto p-2 pt-10 md:p-6 md:pt-14">
          <div className="max-w-6xl mx-auto p-2 md:p-6">
            <Card className="bg-background">
              <CardContent className="space-y-8 px-4">
                {/* User Info Section */}
                <div>
                  <div className="flex items-center gap-4 mb-4">
                    <button
                      onClick={() => routerService.navigateTo({ type: 'main-menu' })}
                      className="flex items-center justify-center h-5 w-5 text-foreground/60 hover:text-accent"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-4">
                    <Avatar className="h-20 w-20">
                      <AvatarImage
                        src={user.image || null || undefined}
                        alt={user.name || 'User'}
                      />
                      <AvatarFallback>
                        {user.name?.charAt(0).toUpperCase() || 'U'}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1">
                      <h3 className="text-2xl font-bold">{user.name || 'Anonymous User'}</h3>
                      {user.email && (
                        <p className="text-muted-foreground">{user.email}</p>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-sm text-muted-foreground">Plan:</span>
                        <Badge
                          variant="secondary"
                          className={`text-xs ${(subscription?.planId === 'max' || subscription?.planId === 'ultra') ? 'bg-constructive/30' : ''}`}
                        >
                          {subscription?.planId ? subscription.planId.charAt(0).toUpperCase() + subscription.planId.slice(1) : 'Free'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Subscription Plans Section */}
                <div id="subscription-plans" className="pt-8">
                  {loading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : (subscription?.planId === 'max' || subscription?.planId === 'ultra') ? (
                    <>
                      <Card className="bg-muted/30 border border-border p-3 md:p-3">
                        <CardContent className="flex items-center gap-4 p-0">
                          {/* Plan Icon */}
                          <div className="flex-shrink-0 w-12 h-12 flex items-center justify-center">
                            <div className="w-10 h-10">
                              {subscription.planId === 'max' ? (
                                <HappyFace className="max-w-full max-h-full text-inherit"/>
                              ) : (
                                <StarFace className="max-w-full max-h-full text-inherit"/>
                              )}
                            </div>
                          </div>

                          {/* Plan Details */}
                          <div className="flex-1">
                            <div className="text-lg font-semibold mb-1">
                              {subscription.planId.charAt(0).toUpperCase() + subscription.planId.slice(1)} Plan
                            </div>
                            <p className="text-sm text-muted-foreground mb-2">
                              {subscription.planId === 'max'
                                ? '10x more than Free'
                                : 'Everything in Max with unlimited agents and priority support'}
                            </p>
                            {subscription.subscriptionCancelAt && (
                              <p className="text-xs text-muted-foreground">
                                Your subscription will end on {new Date(subscription.subscriptionCancelAt).toLocaleDateString()}.
                              </p>
                            )}
                          </div>

                          {/* Update Button - only for Ultra */}
                          {subscription.planId === 'ultra' && (
                            <Button variant="default" size="default">
                              Update
                            </Button>
                          )}
                        </CardContent>
                      </Card>

                      {/* Upgrade to Ultra Card - only for max plan */}
                      {subscription.planId === 'max' && (
                        <Card className="bg-accent/10 border-none p-3 md:p-3 mt-4">
                          <CardContent className="flex items-center gap-4 p-0">
                            {/* Plan Icon */}
                            <div className="flex-shrink-0 w-12 h-12 flex items-center justify-center">
                              <div className="w-10 h-10">
                                <StarFace className="max-w-full max-h-full text-inherit"/>
                              </div>
                            </div>

                            {/* Plan Details */}
                            <div className="flex-1">
                              <div className="text-lg font-semibold mb-1">
                                Upgrade to Ultra
                              </div>
                              <p className="text-sm text-muted-foreground">
                                <span className="text-accent font-semibold">100x</span> more than Free and priority support channel with founders.
                              </p>
                            </div>

                            {/* Upgrade Button */}
                            <Button variant="accent" size="default" onClick={() => handleSubscribe('ultra')}>
                              Upgrade
                            </Button>
                          </CardContent>
                        </Card>
                      )}
                    </>
                  ) : (
                    <>
                      <h2 className="text-xl font-bold text-center mb-6">Available Plans</h2>
                      <div className="grid md:grid-cols-3 gap-6">
                        {plans.map((plan) => (
                          <PricingCard
                            key={plan.id}
                            plan={plan}
                            currentPlanId={subscription?.planId || null}
                            onSubscribe={handleSubscribe}
                            loading={checkoutLoading}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Fallback copiable link for iOS Safari (popup blocked after async) */}
                {checkoutUrl && (
                  <div className="flex flex-col gap-1.5 p-4 rounded-md bg-muted/30 border border-border">
                    <p className="text-sm text-muted-foreground">
                      If the checkout page didn't open, copy and open this link in a new tab:
                    </p>
                    <div className="flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-md bg-background">
                      <code className="flex-1 text-xs text-foreground/50 overflow-x-auto whitespace-nowrap">
                        {checkoutUrl}
                      </code>
                      <button
                        onClick={handleCopyCheckoutUrl}
                        className="h-5 w-5 flex-shrink-0 hover:text-accent"
                      >
                        {copiedCheckoutUrl ? (
                          <Check className="h-3.5 w-3.5 text-green-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Cancel Plan Section */}
                {subscription?.planId && subscription.planId !== 'free' && (
                  <div className="pt-8 border-t border-border">
                    <div className="flex items-center justify-center gap-3">
                      <p className="text-xs text-muted-foreground">
                        Need to cancel your subscription?
                      </p>
                      <button
                        onClick={handleCancelSubscription}
                        disabled={cancelLoading}
                        className="text-xs text-destructive underline hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {cancelLoading ? 'Cancelling...' : 'Cancel Plan'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Legal Links */}
                <div className="flex items-center justify-center gap-4 pt-8 text-xs text-muted-foreground">
                  <a
                    href="https://ariana.dev/terms/terms.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    Terms of Service
                  </a>
                  <span>•</span>
                  <a
                    href="https://ariana.dev/terms/privacy.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    Privacy Policy
                  </a>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
  );
}
