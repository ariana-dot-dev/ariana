import { useState, useEffect } from 'react';
import { Repository } from '@/bindings/types';
import { MentionSuggestion, MentionType, PromptMention } from '@/types/MentionSuggestion';
import type { GithubIssue } from '@/types/GithubIssue';
import type { ProjectWorkspace } from '@/stores/useAppStore';
import { useMentionsPollingStore } from '@/stores/useMentionsPollingStore';

interface UseMentionsReturn {
  mentionSuggestions: MentionSuggestion[];
  selectedMentions: PromptMention[];
  handleAddMentionToInput: (mention: PromptMention) => void;
  resetSelectedMentions: () => void;
}

export function useMentions(projectWorkspace: ProjectWorkspace, isFocused: boolean = true): UseMentionsReturn {
  const [mentionSuggestions, setMentionSuggestions] = useState<MentionSuggestion[]>([]);
  const [selectedMentions, setSelectedMentions] = useState<PromptMention[]>([]);

  // Subscribe to centralized polling store - get the Map objects themselves
  const githubIssuesCache = useMentionsPollingStore(state => state.githubIssuesCache);
  const repositoryNameCache = useMentionsPollingStore(state => state.repositoryNameCache);
  const startPollingForProject = useMentionsPollingStore(state => state.startPollingForProject);

  const handleAddMentionToInput = (mention: PromptMention) => {
    setSelectedMentions(prev => {
      // Prevent duplicates
      if (prev.some(m => m.id === mention.id && m.type === mention.type)) return prev;
      return [...prev, mention];
    });
  };

  const resetSelectedMentions = () => {
    setSelectedMentions([]);
  };

  // Start polling for this project ONLY when this tab is focused
  useEffect(() => {
    if (!isFocused) return;

    startPollingForProject(projectWorkspace.id, projectWorkspace.repositoryId);
  }, [projectWorkspace.id, projectWorkspace.repositoryId, isFocused, startPollingForProject]);

  // Combine GitHub issues into mention suggestions
  useEffect(() => {
    // Get data from caches inside the effect to avoid reference changes causing infinite loops
    const githubIssues = githubIssuesCache.get(projectWorkspace.id) || [];
    const repositoryFullName = repositoryNameCache.get(projectWorkspace.id) || null;

    const suggestions: MentionSuggestion[] = [];

    // Add GitHub issues (only if we have repository full name)
    if (repositoryFullName) {
      githubIssues.forEach(issue => {
        suggestions.push({
          type: MentionType.GithubIssue,
          id: `${repositoryFullName}#${issue.number}`,
          display: " issue | " + issue.number + ": " + issue.title + " "
        });
      });
    }

    setMentionSuggestions(suggestions);
  }, [githubIssuesCache, repositoryNameCache, projectWorkspace.id]);

  return {
    mentionSuggestions,
    selectedMentions,
    handleAddMentionToInput,
    resetSelectedMentions
  };
}