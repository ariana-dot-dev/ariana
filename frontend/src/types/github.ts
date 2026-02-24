import { AccessLevel, InstallationRepository } from "@/bindings/types";

export interface GithubRepository extends InstallationRepository {
}

export interface LocalGitRepo {
  path: string;
  name: string;
  lastCommitDate: number | null; // Unix timestamp in seconds
}
