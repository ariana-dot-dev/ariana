import { RepositoryContainer } from '@/data/repositories';
import { getLogger } from '../utils/logger';
import type { Agent, AgentMessage, AgentPrompt } from '@shared/types';

const logger = getLogger(['agent-search']);

export interface SearchMatch {
  text: string;         // The matched text snippet
  distance: number;     // Levenshtein distance from query
  position: number;     // Position in original text
}

export interface AgentSearchResult {
  agentId: string;
  score: number;
  matches: SearchMatch[];
  excerpt: string;      // ~10 word excerpt around best match with highlighted keyword
  excerptMatchStart: number;  // Start position of match within excerpt
  excerptMatchEnd: number;    // End position of match within excerpt
}

export class AgentSearchService {
  constructor(private repositories: RepositoryContainer) {}

  /**
   * Calculate Levenshtein distance between two strings with early termination.
   * Uses O(n) space instead of O(n*m) and stops early if distance exceeds maxDistance.
   */
  private levenshteinDistance(a: string, b: string, maxDistance: number = Infinity): number {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();

    const aLen = aLower.length;
    const bLen = bLower.length;

    // Quick length-based rejection
    if (Math.abs(aLen - bLen) > maxDistance) return maxDistance + 1;

    if (aLen === 0) return bLen;
    if (bLen === 0) return aLen;

    // Use two rows instead of full matrix - O(n) space
    let prevRow = new Array(aLen + 1);
    let currRow = new Array(aLen + 1);

    // Initialize first row
    for (let j = 0; j <= aLen; j++) {
      prevRow[j] = j;
    }

    // Fill rows with early termination
    for (let i = 1; i <= bLen; i++) {
      currRow[0] = i;
      let rowMin = i; // Track minimum in current row for early exit

      for (let j = 1; j <= aLen; j++) {
        if (bLower.charCodeAt(i - 1) === aLower.charCodeAt(j - 1)) {
          currRow[j] = prevRow[j - 1];
        } else {
          currRow[j] = 1 + Math.min(
            prevRow[j - 1], // substitution
            currRow[j - 1], // insertion
            prevRow[j]      // deletion
          );
        }
        if (currRow[j] < rowMin) rowMin = currRow[j];
      }

      // Early termination: if minimum in row exceeds maxDistance, no need to continue
      if (rowMin > maxDistance) return maxDistance + 1;

      // Swap rows
      [prevRow, currRow] = [currRow, prevRow];
    }

    return prevRow[aLen];
  }

  /**
   * Find all substrings of a given length in text and calculate their distance to query.
   * Optimized: First checks for exact/substring matches before expensive Levenshtein.
   */
  private findMatches(text: string, query: string, maxDistance: number): SearchMatch[] {
    const matches: SearchMatch[] = [];
    const queryLen = query.length;
    const textLower = text.toLowerCase();
    const queryLower = query.toLowerCase();

    // Fast path: Check for exact substring match first
    let idx = 0;
    while ((idx = textLower.indexOf(queryLower, idx)) !== -1) {
      matches.push({
        text: text.substring(idx, idx + queryLen),
        distance: 0,
        position: idx
      });
      idx += 1;
    }

    // If we found exact matches, return them (best possible score)
    if (matches.length > 0) {
      return matches;
    }

    // If maxDistance is 0, only exact matches count (already checked above)
    if (maxDistance === 0) {
      return [];
    }

    // Slow path: Fuzzy matching with Levenshtein
    // Sample positions instead of checking every character for very long texts
    const maxTextLen = 10000; // Limit search to first 10k chars
    const effectiveLen = Math.min(text.length, maxTextLen);

    // For long texts, sample every N positions to reduce computation
    const step = effectiveLen > 2000 ? Math.floor(effectiveLen / 1000) : 1;

    for (let windowSize = Math.max(1, queryLen - 1); windowSize <= queryLen + 1; windowSize++) {
      for (let i = 0; i <= effectiveLen - windowSize; i += step) {
        const substring = textLower.substring(i, i + windowSize);
        const distance = this.levenshteinDistance(substring, queryLower, maxDistance);

        if (distance <= maxDistance) {
          // Avoid duplicate matches at same position
          const existingMatch = matches.find(m =>
            Math.abs(m.position - i) < queryLen && m.distance <= distance
          );

          if (!existingMatch) {
            matches.push({
              text: text.substring(i, i + windowSize),
              distance,
              position: i
            });
          }
        }
      }
    }

    // Sort by distance (best first), then by position
    return matches.sort((a, b) => a.distance - b.distance || a.position - b.position);
  }

  /**
   * Calculate search score based on match distances
   * Score formula: sum of 10^(third - distance) for each match
   * where third = floor(queryLength / 3)
   */
  private calculateScore(matches: SearchMatch[], queryLength: number): number {
    const third = Math.floor(queryLength / 3);
    let score = 0;

    // Count matches at each distance level
    const distanceCounts: number[] = new Array(third + 1).fill(0);

    for (const match of matches) {
      if (match.distance <= third) {
        distanceCounts[match.distance]++;
      }
    }

    // Calculate score: N_d0 * 10^third + N_d1 * 10^(third-1) + ...
    for (let d = 0; d <= third; d++) {
      const exponent = third - d;
      score += distanceCounts[d] * Math.pow(10, exponent);
    }

    return score;
  }

  /**
   * Generate a ~10 word excerpt around the best match
   */
  private generateExcerpt(
    text: string,
    match: SearchMatch
  ): { excerpt: string; matchStart: number; matchEnd: number } {
    const wordsBeforeAfter = 5;
    const matchPos = match.position;
    const matchLen = match.text.length;

    // Find word boundaries around match
    let excerptStart = matchPos;
    let excerptEnd = matchPos + matchLen;

    // Count words before
    let wordsBefore = 0;
    let i = matchPos - 1;
    let inWord = false;
    while (i >= 0 && wordsBefore < wordsBeforeAfter) {
      const char = text[i];
      const isWordChar = /\w/.test(char);
      if (isWordChar && !inWord) {
        inWord = true;
      } else if (!isWordChar && inWord) {
        wordsBefore++;
        inWord = false;
      }
      if (wordsBefore < wordsBeforeAfter) {
        excerptStart = i;
      }
      i--;
    }

    // Count words after
    let wordsAfter = 0;
    i = matchPos + matchLen;
    inWord = false;
    while (i < text.length && wordsAfter < wordsBeforeAfter) {
      const char = text[i];
      const isWordChar = /\w/.test(char);
      if (isWordChar && !inWord) {
        inWord = true;
      } else if (!isWordChar && inWord) {
        wordsAfter++;
        inWord = false;
      }
      excerptEnd = i + 1;
      i++;
    }

    // Clean up excerpt boundaries to word boundaries
    while (excerptStart > 0 && /\w/.test(text[excerptStart - 1])) {
      excerptStart--;
    }
    while (excerptEnd < text.length && /\w/.test(text[excerptEnd])) {
      excerptEnd++;
    }

    let excerpt = text.substring(excerptStart, excerptEnd).trim();

    // Add ellipsis if truncated
    const prefix = excerptStart > 0 ? '...' : '';
    const suffix = excerptEnd < text.length ? '...' : '';

    // Calculate match position within the final excerpt
    const matchStartInExcerpt = prefix.length + (matchPos - excerptStart);
    const matchEndInExcerpt = matchStartInExcerpt + matchLen;

    excerpt = prefix + excerpt + suffix;

    return {
      excerpt,
      matchStart: matchStartInExcerpt,
      matchEnd: matchEndInExcerpt
    };
  }

  /**
   * Search agents by query string
   * Searches in: agent task name/summary, and message content (excluding tool calls)
   *
   * Optimized: Uses batch queries instead of N+1 pattern
   */
  async searchAgents(
    userId: string,
    query: string,
    accessibleAgentIds: string[]
  ): Promise<AgentSearchResult[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const trimmedQuery = query.trim();
    const queryLength = trimmedQuery.length;
    const maxDistance = Math.floor(queryLength / 3);

    logger.info`Searching agents for user ${userId} with query "${trimmedQuery}" (maxDistance: ${maxDistance})`;

    // Batch fetch all data in parallel (3 queries total instead of 3*N)
    const [agents, allMessages, allPrompts] = await Promise.all([
      this.repositories.agents.findMany({
        id: { in: accessibleAgentIds },
        isTrashed: false
      }),
      this.repositories.agentMessages.findMany({
        agentId: { in: accessibleAgentIds },
        isReverted: false
      }),
      this.repositories.agentPrompts.findMany({
        agentId: { in: accessibleAgentIds }
      })
    ]);

    // Index messages and prompts by agentId for O(1) lookup
    const messagesByAgent = new Map<string, typeof allMessages>();
    for (const msg of allMessages) {
      const existing = messagesByAgent.get(msg.agentId) || [];
      existing.push(msg);
      messagesByAgent.set(msg.agentId, existing);
    }

    const promptsByAgent = new Map<string, typeof allPrompts>();
    for (const prompt of allPrompts) {
      const existing = promptsByAgent.get(prompt.agentId) || [];
      existing.push(prompt);
      promptsByAgent.set(prompt.agentId, existing);
    }

    // Process each agent
    const agentResults: Map<string, {
      matches: SearchMatch[];
      bestMatch: SearchMatch | null;
      bestMatchText: string;
    }> = new Map();

    for (const agent of agents) {
      const allMatches: SearchMatch[] = [];
      let bestMatch: SearchMatch | null = null;
      let bestMatchText = '';

      // Helper to update best match
      const updateBestMatch = (matches: SearchMatch[], sourceText: string) => {
        if (matches.length === 0) return;
        allMatches.push(...matches);
        const firstMatch = matches[0];
        if (bestMatch === null || firstMatch.distance < bestMatch.distance) {
          bestMatch = firstMatch;
          bestMatchText = sourceText;
        }
      };

      // Search in agent name
      if (agent.name) {
        const nameMatches = this.findMatches(agent.name, trimmedQuery, maxDistance);
        updateBestMatch(nameMatches, agent.name);
      }

      // Search in task summary
      if (agent.taskSummary) {
        const summaryMatches = this.findMatches(agent.taskSummary, trimmedQuery, maxDistance);
        updateBestMatch(summaryMatches, agent.taskSummary);
      }

      // Search in messages (already filtered to non-reverted)
      const messages = messagesByAgent.get(agent.id) || [];
      for (const msg of messages) {
        const content = msg.content;
        if (!content) continue;

        const msgMatches = this.findMatches(content, trimmedQuery, maxDistance);
        updateBestMatch(msgMatches, content);
      }

      // Search in prompt texts
      const prompts = promptsByAgent.get(agent.id) || [];
      for (const prompt of prompts) {
        if (!prompt.prompt) continue;

        // Remove wrapped additional information before searching
        const cleanPrompt = this.removePromptAdditionalInfo(prompt.prompt);

        const promptMatches = this.findMatches(cleanPrompt, trimmedQuery, maxDistance);
        updateBestMatch(promptMatches, cleanPrompt);
      }

      if (allMatches.length > 0 && bestMatch) {
        agentResults.set(agent.id, {
          matches: allMatches,
          bestMatch,
          bestMatchText
        });
      }
    }

    // Convert to results with scores and excerpts
    const results: AgentSearchResult[] = [];

    for (const [agentId, data] of agentResults) {
      const score = this.calculateScore(data.matches, queryLength);
      const { excerpt, matchStart, matchEnd } = this.generateExcerpt(
        data.bestMatchText,
        data.bestMatch!
      );

      results.push({
        agentId,
        score,
        matches: data.matches.slice(0, 10), // Limit stored matches
        excerpt,
        excerptMatchStart: matchStart,
        excerptMatchEnd: matchEnd
      });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    logger.info`Found ${results.length} matching agents for query "${trimmedQuery}"`;

    return results;
  }

  /**
   * Remove prompt additional information wrapper
   */
  private removePromptAdditionalInfo(content: string): string {
    const regex = /<<PROMPT_ADDITIONAL_INFORMATION>>[\s\S]*?<<PROMPT_ADDITIONAL_INFORMATION>>/g;
    return content.replace(regex, '').trim();
  }
}
