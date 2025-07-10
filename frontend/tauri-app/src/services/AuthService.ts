interface User {
	id: string;
	email: string;
	name: string;
	avatar: string;
	provider: 'google' | 'github';
}

interface AuthState {
	isAuthenticated: boolean;
	user: User | null;
	token: string | null;
}

class AuthService {
	private static instance: AuthService;
	private authState: AuthState = {
		isAuthenticated: false,
		user: null,
		token: null,
	};
	private listeners: Array<(state: AuthState) => void> = [];

	static getInstance(): AuthService {
		if (!AuthService.instance) {
			AuthService.instance = new AuthService();
		}
		return AuthService.instance;
	}

	private constructor() {
		// Load auth state from localStorage on initialization
		this.loadAuthState();
	}

	private loadAuthState(): void {
		try {
			const savedAuth = localStorage.getItem('ariana-auth');
			if (savedAuth) {
				const parsedAuth = JSON.parse(savedAuth);
				// Validate the token is still valid (basic check)
				if (parsedAuth.token && parsedAuth.user) {
					this.authState = parsedAuth;
				}
			}
		} catch (error) {
			console.error('Failed to load auth state:', error);
			this.clearAuthState();
		}
	}

	private saveAuthState(): void {
		try {
			localStorage.setItem('ariana-auth', JSON.stringify(this.authState));
		} catch (error) {
			console.error('Failed to save auth state:', error);
		}
	}

	private clearAuthState(): void {
		this.authState = {
			isAuthenticated: false,
			user: null,
			token: null,
		};
		localStorage.removeItem('ariana-auth');
		this.notifyListeners();
	}

	private notifyListeners(): void {
		this.listeners.forEach(listener => listener(this.authState));
	}

	public getAuthState(): AuthState {
		return { ...this.authState };
	}

	public subscribe(listener: (state: AuthState) => void): () => void {
		this.listeners.push(listener);
		// Return unsubscribe function
		return () => {
			const index = this.listeners.indexOf(listener);
			if (index > -1) {
				this.listeners.splice(index, 1);
			}
		};
	}

	public setAuthenticated(token: string, user: User): void {
		this.authState = {
			isAuthenticated: true,
			user,
			token,
		};
		this.saveAuthState();
		this.notifyListeners();
	}

	public logout(): void {
		this.clearAuthState();
	}

	public async validateToken(): Promise<boolean> {
		if (!this.authState.token) {
			return false;
		}

		try {
			const response = await fetch('https://api2.ariana.dev/api/profile', {
				headers: {
					'Authorization': `Bearer ${this.authState.token}`,
				},
			});

			if (response.ok) {
				return true;
			} else {
				// Token is invalid, clear auth state
				this.clearAuthState();
				return false;
			}
		} catch (error) {
			console.error('Token validation failed:', error);
			// Network error, assume token might still be valid
			return this.authState.isAuthenticated;
		}
	}

	public getAuthHeader(): Record<string, string> {
		if (this.authState.token) {
			return {
				'Authorization': `Bearer ${this.authState.token}`,
			};
		}
		return {};
	}

	public async apiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
		const headers = {
			'Content-Type': 'application/json',
			...this.getAuthHeader(),
			...options.headers,
		};

		const response = await fetch(url, {
			...options,
			headers,
		});

		if (response.status === 401) {
			// Unauthorized, clear auth state
			this.clearAuthState();
			throw new Error('Authentication required');
		}

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		return response.json();
	}
}

export default AuthService;
export type { User, AuthState };