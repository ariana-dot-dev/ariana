
export enum MentionType {
  GithubIssue = 'GithubIssue',
  Specification = 'Specification'
}

export interface Mention {
    id: string;
    type: MentionType;
}

export interface GithubIssueMention {
    title: string;
    body: string;
}
