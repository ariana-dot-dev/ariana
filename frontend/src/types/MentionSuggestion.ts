export enum MentionType {
  GithubIssue = 'GithubIssue'
}

export interface MentionSuggestion {
  type: MentionType;
  id: string;
  display: string;
}

export interface PromptMention {
  id: string;
  type: MentionType;
}
