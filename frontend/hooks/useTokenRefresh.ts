import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect } from 'react';
import { refreshJwtToken } from '../utils/api';

/**
 * Custom hook to handle automatic token refresh
 * This hook ensures that the user's session is always valid by refreshing tokens when needed
 */
export function useTokenRefresh() {
  const { data: session, update } = useSession();
  const router = useRouter();

  const checkAndRefreshToken = useCallback(async () => {
    if (!session?.jwt_token || !session?.refresh_token) {
      return false;
    }

    // If the session has an error (e.g., refresh token expired), sign out
    if (session.error === 'RefreshTokenError') {
      await signOut({ callbackUrl: '/signin' });
      return false;
    }

    // Check if token expires in the next 5 minutes
    const currentTime = Math.floor(Date.now() / 1000);
    const tokenExpires = session.expires_in || 0;
    
    if (tokenExpires > currentTime + 300) {
      return true; // Token is still valid
    }

    try {
      // Attempt to refresh the token
      const refreshedTokens = await refreshJwtToken(session.refresh_token);
      
      // Update the session with new tokens
      await update({
        ...session,
        jwt_token: 'Bearer ' + refreshedTokens.access_token,
        expires_in: refreshedTokens.expires_in,
      });
      
      return true;
    } catch (error) {
      console.error('Failed to refresh token:', error);
      // Refresh token is expired or invalid, redirect to login
      router.push('/signin');
      return false;
    }
  }, [session, update, router]);

  // Check token validity on mount and periodically
  useEffect(() => {
    if (session?.jwt_token) {
      checkAndRefreshToken();
      
      // Set up periodic check every 15 minutes
      const interval = setInterval(checkAndRefreshToken, 15 * 60 * 1000);
      
      return () => clearInterval(interval);
    }
  }, [session?.jwt_token, checkAndRefreshToken]);

  return {
    checkAndRefreshToken,
    isAuthenticated: !!session?.jwt_token,
  };
}

/**
 * Higher-order function that wraps API calls with automatic token refresh
 */
export function withTokenRefresh<T extends (...args: any[]) => Promise<any>>(
  apiCall: T
): T {
  return (async (...args: Parameters<T>) => {
    // This would be used in individual API calls if needed
    // For now, the session middleware handles token refresh automatically
    return apiCall(...args);
  }) as T;
}

/**
 * Custom hook to get the current valid JWT token
 * This hook ensures the token is always valid by refreshing it if needed
 */
export function useAuthToken() {
  const { data: session } = useSession();
  const { checkAndRefreshToken } = useTokenRefresh();

  const getValidToken = useCallback(async () => {
    const isValid = await checkAndRefreshToken();
    if (!isValid) {
      throw new Error('Unable to get valid authentication token');
    }
    return session?.jwt_token;
  }, [session?.jwt_token, checkAndRefreshToken]);

  return {
    token: session?.jwt_token,
    getValidToken,
    isAuthenticated: !!session?.jwt_token,
  };
}
