import { useState, useEffect } from 'react';
import AuthService, { type AuthState } from '../services/AuthService';

export function useAuth() {
	const authService = AuthService.getInstance();
	const [authState, setAuthState] = useState<AuthState>(authService.getAuthState());
	const [isValidating, setIsValidating] = useState(false);

	useEffect(() => {
		// Subscribe to auth state changes
		const unsubscribe = authService.subscribe(setAuthState);

		// Validate token on mount if authenticated
		if (authState.isAuthenticated) {
			setIsValidating(true);
			authService.validateToken().finally(() => {
				setIsValidating(false);
			});
		}

		return unsubscribe;
	}, []);

	const login = (token: string, user: any) => {
		authService.setAuthenticated(token, user);
	};

	const logout = () => {
		authService.logout();
	};

	const validateToken = async (): Promise<boolean> => {
		setIsValidating(true);
		try {
			return await authService.validateToken();
		} finally {
			setIsValidating(false);
		}
	};

	return {
		...authState,
		isValidating,
		login,
		logout,
		validateToken,
		authService,
	};
}