import {
  type GithubIssueMention,
  type Mention,
  MentionType,
} from '@shared/types';
import { RepositoryContainer } from '@/data/repositories';
import { GitHubService } from './github.service';
import { getLogger } from '../utils/logger';

const logger = getLogger(['mention']);

export class MentionService {
  constructor(
    private repositories: RepositoryContainer,
    private githubService: GitHubService
  ) {}

  async mentionsToString(
    mentions: Mention[],
    userId: string,
  ): Promise<string> {

    let mentionString: string = "";

    for (const mention of mentions) {
      try {
        const data = await this.mentionToString(mention, userId);
        mentionString += data;
      } catch (error) {
        logger.error`Failed to process mention ${mention.id}: ${error}`;
      }
    }
    
    return mentionString;
  }

  async mentionToString(mention: Mention, userId: string): Promise<string> {
    switch (mention.type) {
      case MentionType.GithubIssue:
        return await this.fetchGithubIssue(mention, userId);
      default:
        logger.warn`Unknown mention type: ${mention.type}`;
        throw new Error(`Unknown mention type: ${mention.type}`);
    }
  }

  private async fetchGithubIssue(mention: Mention, userId: string): Promise<string> {
    try {
      // Expect mention.id to be in format "owner/repo#issueNumber"
      const issueId = mention.id;
      const match = issueId.match(/^(.+)\/(.+)#(\d+)$/);
      
      if (!match) {
        logger.error`Invalid GitHub issue mention format: ${issueId}. Expected format: owner/repo#issueNumber`;
        return "";
      }

      const [_, owner, repo, issueNumberStr] = match;
      const issueNumber = parseInt(issueNumberStr);

      const issue: GithubIssueMention = await this.githubService.getIssue(userId, owner, repo, issueNumber);

      return `
        \n
        --- 
        # GitHub Issue ${owner}/${repo}#${issueNumber}: ${issue.title}\n
        
        ## Description \n
          ${issue.body} \n
       `;
    } catch (error) {
      logger.error`Failed to fetch GitHub issue: ${error}`;
      return "";
    }
  }
}