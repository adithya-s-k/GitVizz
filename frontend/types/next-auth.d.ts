import NextAuth from 'next-auth';

declare module 'next-auth' {
  interface Session {
    accessToken?: any;
    jwt_token?: any;
    expires_in?: number;
    user_id?: any;
    token_type?: any;
    refresh_token?: any;
  }
  interface JWT {
    accessToken?: any;
    jwt_token?: any;
    expires_in?: number;
    user_id?: any;
    token_type?: any;
    refresh_token?: any;
    refresh_expires_in?: number;
    exp?: number;
  }
}
