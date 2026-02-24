import { MentionSuggestion, MentionType } from '@/types/MentionSuggestion';

/**
 * Transforms mention display text with appropriate prefixes and length limits
 * @param id - The mention suggestion ID
 * @param display - The original display text
 * @param suggestions - Array of all mention suggestions to find the type
 * @returns Formatted mention text with prefix and trimming
 */
export function transformMentionDisplay(
  id: string, 
  display: string, 
  suggestions: MentionSuggestion[]
): string {
  // Find the suggestion to get its type
  const suggestion = suggestions.find(s => s.id === id);
  if (!suggestion) return display;

  let prefix = '';
  let content = display.trim();

  if (suggestion.type === MentionType.GithubIssue) {
    prefix = 'issue:';
    // Extract title from format " @issue| 10: title "
    const titleMatch = content.match(/@issue\|\s*\d+:\s*(.+)$/);
    content = titleMatch ? titleMatch[1].trim() : content;
  }

  // Trim content to 25 characters if needed
  const maxContentLength = 25;
  if (content.length > maxContentLength) {
    content = content.substring(0, maxContentLength) + '...';
  }

  return " " + `${prefix}[${content}]` + " ";
}