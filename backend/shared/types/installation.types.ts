// GitHub Installation types

import type { AccessLevel } from "./auth/github-access.types";

export enum InstallationType {
  User = 'User',
  Organization = 'Organization'
}

export interface InstallationRepository {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  url: string;
  private: boolean;
  permissions: AccessLevel;
  pushedAt: string | null;
  lastUserCommitAt?: string | null;
}

export interface Installation {
  type: InstallationType;
  accountLogin: string;
  accountAvatarUrl: string | null;
  repositories: InstallationRepository[];
}

export interface InstallationsResponse {
  installations: Installation[];
}