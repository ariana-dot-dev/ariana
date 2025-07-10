import React, { useState } from "react";
import { cn } from "../utils";
import Logo from "./Logo";
import OAuthCallback from "./OAuthCallback";

interface AuthPageProps {
	onAuthenticated?: (token: string, user: any) => void;
	onError?: (error: string) => void;
}

const AuthPage: React.FC<AuthPageProps> = ({ onAuthenticated, onError }) => {
	const [isLoading, setIsLoading] = useState(false);
	const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
	const [showCallback, setShowCallback] = useState(false);
	const [currentAuthUrl, setCurrentAuthUrl] = useState<string | null>(null);

	const handleOAuthLogin = async (provider: 'google' | 'github') => {
		setIsLoading(true);
		setLoadingProvider(provider);

		try {
			// Create OAuth URL
			const authUrl = `https://api2.ariana.dev/auth/${provider}`;
			setCurrentAuthUrl(authUrl);
			
			// Try to open in browser using Tauri shell
			try {
				const { open } = await import('@tauri-apps/plugin-shell');
				await open(authUrl);
				console.log(`Opened ${provider} OAuth URL in browser`);
			} catch (shellError) {
				console.warn('Shell plugin failed, providing manual URL:', shellError);
				// Fallback: copy URL to clipboard and show instructions
				try {
					await navigator.clipboard.writeText(authUrl);
					onError?.(`Could not open browser automatically. The OAuth URL has been copied to your clipboard. Please paste it in your browser: ${authUrl}`);
				} catch (clipboardError) {
					console.warn('Clipboard access failed:', clipboardError);
					onError?.(`Please manually open this URL in your browser: ${authUrl}`);
				}
			}

			// Show the callback component for manual token entry
			setShowCallback(true);
		} catch (error) {
			console.error(`${provider} authentication failed:`, error);
			onError?.(`Failed to initiate ${provider} authentication: ${error}`);
		} finally {
			setIsLoading(false);
			setLoadingProvider(null);
		}
	};

	return (
		<div className={cn(
			"h-screen w-screen flex items-center justify-center",
			"bg-gradient-to-br from-[var(--base-200)] to-[var(--base-300)]"
		)}>
			<div className={cn(
				"bg-[var(--base-100)] rounded-2xl shadow-xl p-8 w-full max-w-md mx-4",
				"border border-[var(--base-400-20)]"
			)}>
				{/* Logo and Header */}
				<div className="flex flex-col items-center mb-8">
					<div className="w-20 h-20 mb-4">
						<Logo className="text-[var(--acc-600)] hover:scale-105 transition-transform duration-300" />
					</div>
					<h1 className="text-2xl font-bold text-[var(--blackest)] mb-2">
						Welcome to Ariana IDE
					</h1>
					<p className="text-[var(--base-600)] text-center text-sm">
						Choose your preferred authentication method to continue
					</p>
				</div>

				{/* OAuth Buttons */}
				<div className="space-y-4">
					{/* Google OAuth Button */}
					<button
						onClick={() => handleOAuthLogin('google')}
						disabled={isLoading}
						className={cn(
							"w-full flex items-center justify-center gap-3 px-4 py-3",
							"bg-white border border-gray-300 rounded-lg",
							"hover:bg-gray-50 hover:border-gray-400",
							"transition-all duration-200",
							"disabled:opacity-60 disabled:cursor-not-allowed",
							loadingProvider === 'google' && "bg-gray-50"
						)}
					>
						{loadingProvider === 'google' ? (
							<div className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
						) : (
							<svg className="w-5 h-5" viewBox="0 0 24 24">
								<path
									fill="#4285F4"
									d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
								/>
								<path
									fill="#34A853"
									d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
								/>
								<path
									fill="#FBBC05"
									d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
								/>
								<path
									fill="#EA4335"
									d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
								/>
							</svg>
						)}
						<span className="text-gray-700 font-medium">
							Continue with Google
						</span>
					</button>

					{/* GitHub OAuth Button */}
					<button
						onClick={() => handleOAuthLogin('github')}
						disabled={isLoading}
						className={cn(
							"w-full flex items-center justify-center gap-3 px-4 py-3",
							"bg-[#24292e] border border-[#24292e] rounded-lg",
							"hover:bg-[#2c333a] hover:border-[#2c333a]",
							"transition-all duration-200",
							"disabled:opacity-60 disabled:cursor-not-allowed",
							loadingProvider === 'github' && "bg-[#2c333a]"
						)}
					>
						{loadingProvider === 'github' ? (
							<div className="w-5 h-5 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
						) : (
							<svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
								<path d="M12 0C5.374 0 0 5.373 0 12 0 17.302 3.438 21.8 8.207 23.387c.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
							</svg>
						)}
						<span className="text-white font-medium">
							Continue with GitHub
						</span>
					</button>
				</div>

				{/* Footer */}
				<div className="mt-8 text-center">
					<p className="text-xs text-[var(--base-500)]">
						By continuing, you agree to our Terms of Service and Privacy Policy
					</p>
				</div>
			</div>

			{/* OAuth Callback Modal */}
			{showCallback && (
				<OAuthCallback
					authUrl={currentAuthUrl || undefined}
					onTokenReceived={(token, user) => {
						onAuthenticated?.(token, user);
						setShowCallback(false);
						setCurrentAuthUrl(null);
					}}
					onError={(error) => {
						onError?.(error);
						setShowCallback(false);
						setCurrentAuthUrl(null);
					}}
					onCancel={() => {
						setShowCallback(false);
						setCurrentAuthUrl(null);
					}}
				/>
			)}
		</div>
	);
};

export default AuthPage;