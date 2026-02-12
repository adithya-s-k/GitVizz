import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import { getJwtToken, refreshJwtToken } from './api';

// Get the correct backend URL for server-side requests
const getBackendUrl = () => {
  // In Docker environment, use internal container networking for server-side calls
  if (process.env.NODE_ENV === 'production' && process.env.DOCKER_ENV) {
    return process.env.NEXT_PUBLIC_BACKEND_URL?.replace('localhost', 'backend') || 'http://backend:8003';
  }
  return process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8003';
};

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      authorization: { params: { scope: 'read:user user:email' } },
    }),
  ],
  trustHost: true,
  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60, // 7 days
    updateAge: 24 * 60 * 60, // 24 hours
    // maxAge: 60, // 1 minute
    // updateAge: 60, // 1 minute
  },
  callbacks: {
    jwt: async ({ token, account }) => {
      // Initial sign in
      if (account) {
        token.accessToken = account.access_token;

        // Get JWT token and refresh token from backend
        if (typeof token.accessToken === 'string') {
          try {
            let data = await getJwtToken(token.accessToken);

            token.jwt_token = 'Bearer ' + data.jwt_token;
            token.backendTokenExp = data.expires_in;
            token.user_id = data.user_id;
            token.token_type = data.token_type;
            token.refresh_token = data.refresh_token;
            token.refresh_expires_in = data.refresh_expires_in;
          } catch (error) {
            console.error('Failed to get JWT token during login:', error);
            return token; // Return token as-is; don't force re-authentication on transient errors
          }
        }
      }

      // Return previous token if the backend access token has not expired yet
      const currentTime = Math.floor(Date.now() / 1000);
      if (token.backendTokenExp && currentTime < token.backendTokenExp - 300) {
        // Token still valid (with 5 minute buffer before expiry)
        return token;
      }

      // Backend access token has expired, try to update it using refresh token
      if (token.refresh_token) {
        try {
          const refreshedTokens = await refreshJwtToken(token.refresh_token as string);

          return {
            ...token,
            jwt_token: 'Bearer ' + refreshedTokens.access_token,
            backendTokenExp: refreshedTokens.expires_in,
          };
        } catch (error) {
          console.error('Failed to refresh token:', error);
          // Return token with error flag instead of null to avoid losing session
          return { ...token, error: 'RefreshTokenError' };
        }
      }

      // No refresh token available but don't destroy the session
      return token;
    },
    session: async ({ session, token }) => {
      if (!token) {
        return session;
      }

      session.accessToken = token.accessToken;
      session.jwt_token = token.jwt_token;
      session.expires_in = token.backendTokenExp ?? 0;
      session.user_id = token.user_id;
      session.token_type = token.token_type;
      session.refresh_token = token.refresh_token;
      if (token.error) {
        session.error = token.error;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
});
