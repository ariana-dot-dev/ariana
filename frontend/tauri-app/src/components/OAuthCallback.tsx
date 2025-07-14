import React, { useState } from "react";
import { cn } from "../utils";

interface OAuthCallbackProps {
	onTokenReceived: (token: string, user: any) => void;
	onError: (error: string) => void;
	onCancel: () => void;
	authUrl?: string;
}

const OAuthCallback: React.FC<OAuthCallbackProps> = ({ onTokenReceived, onError, onCancel, authUrl }) => {
	const [manualToken, setManualToken] = useState("");
	const [isProcessing, setIsProcessing] = useState(false);

	const copyUrlToClipboard = async () => {
		if (authUrl) {
			try {
				await navigator.clipboard.writeText(authUrl);
				// Brief visual feedback
			} catch (error) {
				console.warn('Failed to copy URL:', error);
			}
		}
	};

	const handleManualToken = async () => {
		if (!manualToken.trim()) {
			onError("Please enter a valid token");
			return;
		}

		setIsProcessing(true);
		try {
			// Try to get user profile with the token
			const response = await fetch('https://api2.ariana.dev/api/profile', {
				headers: {
					'Authorization': `Bearer ${manualToken.trim()}`,
				},
			});

			if (response.ok) {
				const userData = await response.json();
				onTokenReceived(manualToken.trim(), userData.user);
			} else {
				onError("Invalid token. Please check and try again.");
			}
		} catch (error) {
			onError("Failed to validate token. Please check your connection and try again.");
		} finally {
			setIsProcessing(false);
		}
	};

	return (
		<div className={cn(
			"fixed inset-0 bg-black/50 flex items-center justify-center z-50"
		)}>
			<div className={cn(
				"bg-[var(--base-100)] rounded-2xl shadow-xl p-8 w-full max-w-md mx-4",
				"border border-[var(--base-400-20)]"
			)}>
				<div className="text-center mb-6">
					<h2 className="text-xl font-bold text-[var(--blackest)] mb-2">
						Complete Authentication
					</h2>
					<p className="text-[var(--base-600)] text-sm mb-4">
						{authUrl ? 
							"Please open the URL below in your browser to complete OAuth authentication." :
							"After completing OAuth in your browser, you'll receive a token. Copy and paste it below to complete the authentication."
						}
					</p>
				</div>

				{/* OAuth URL Section */}
				{authUrl && (
					<div className="mb-6 p-4 bg-[var(--base-50)] border border-[var(--base-300)] rounded-lg">
						<label className="block text-sm font-medium text-[var(--base-700)] mb-2">
							OAuth URL (Click to copy, then open in your browser)
						</label>
						<div className="flex gap-2">
							<input
								type="text"
								value={authUrl}
								readOnly
								className={cn(
									"flex-1 px-3 py-2 text-xs border border-[var(--base-400)] rounded",
									"bg-[var(--base-100)] text-[var(--base-700)] font-mono",
									"focus:outline-none focus:ring-1 focus:ring-[var(--acc-500)]"
								)}
							/>
							<button
								onClick={copyUrlToClipboard}
								className={cn(
									"px-3 py-2 bg-[var(--acc-600)] text-white rounded text-xs",
									"hover:bg-[var(--acc-700)] transition-colors"
								)}
							>
								Copy
							</button>
						</div>
						<p className="text-xs text-[var(--base-500)] mt-2">
							After authenticating, you'll be redirected to a page showing your token.
						</p>
					</div>
				)}

				<div className="space-y-4">
					<div>
						<label className="block text-sm font-medium text-[var(--base-700)] mb-2">
							Authentication Token
						</label>
						<textarea
							value={manualToken}
							onChange={(e) => setManualToken(e.target.value)}
							placeholder="Paste your authentication token here..."
							className={cn(
								"w-full px-3 py-2 border border-[var(--base-400)] rounded-lg",
								"bg-[var(--base-50)] text-[var(--blackest)]",
								"focus:outline-none focus:ring-2 focus:ring-[var(--acc-500)]",
								"resize-none h-24"
							)}
						/>
					</div>

					<div className="flex gap-3">
						<button
							onClick={handleManualToken}
							disabled={isProcessing || !manualToken.trim()}
							className={cn(
								"flex-1 px-4 py-2 bg-[var(--acc-600)] text-white rounded-lg",
								"hover:bg-[var(--acc-700)] transition-colors",
								"disabled:opacity-50 disabled:cursor-not-allowed",
								"flex items-center justify-center gap-2"
							)}
						>
							{isProcessing ? (
								<>
									<div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
									Validating...
								</>
							) : (
								"Continue"
							)}
						</button>
						<button
							onClick={onCancel}
							disabled={isProcessing}
							className={cn(
								"px-4 py-2 border border-[var(--base-400)] text-[var(--base-700)] rounded-lg",
								"hover:bg-[var(--base-100)] transition-colors",
								"disabled:opacity-50 disabled:cursor-not-allowed"
							)}
						>
							Cancel
						</button>
					</div>

					<div className="text-xs text-[var(--base-500)] text-center">
						<p>The token should look like: eyJhbGciOiJIUzI1NiIsInR5cCI...</p>
					</div>
				</div>
			</div>
		</div>
	);
};

export default OAuthCallback;