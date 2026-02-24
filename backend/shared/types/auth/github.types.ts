// GitHub authentication types

export interface GithubToken {
  id: string;
  userId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
}

export interface DbGithubToken {
  id: string;
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: number | null;
  scope: string | null;
  created_at: number;
  token_type?: string;
}

export function transformGithubToken(dbToken: DbGithubToken): GithubToken {
  return {
    id: dbToken.id,
    userId: dbToken.user_id,
    accessToken: dbToken.access_token,
    refreshToken: dbToken.refresh_token,
    expiresAt: dbToken.expires_at ? new Date(dbToken.expires_at * 1000) : null,
    scope: dbToken.scope
  };
}