import { useState, useEffect } from 'react';
import { ClarificationQuestion, MOCK_CLARIFICATION_QUESTIONS } from '../mock/RefineTogether';

interface UseClarificationReturn {
  clarifyMode: boolean;
  setClarifyMode: (mode: boolean) => void;
  clarificationQuestions: ClarificationQuestion[];
  showClarificationBar: boolean;
  currentSubjectIndex: number;
  showClarificationForm: boolean;
  clarificationAnswers: Record<string, string>;
  simulateClarificationRequest: () => void;
  handleClarificationSubmit: () => void;
  handleSkipClarification: () => void;
  setShowClarificationForm: (show: boolean) => void;
  setClarificationAnswers: (answers: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
}

export function useClarification(): UseClarificationReturn {
  const [clarifyMode, setClarifyMode] = useState<boolean>(false);
  const [clarificationQuestions, setClarificationQuestions] = useState<ClarificationQuestion[]>([]);
  const [showClarificationBar, setShowClarificationBar] = useState<boolean>(false);
  const [currentSubjectIndex, setCurrentSubjectIndex] = useState<number>(0);
  const [showClarificationForm, setShowClarificationForm] = useState<boolean>(false);
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>({});

  // Simulate clarification response
  const simulateClarificationRequest = () => {
    if (clarifyMode) {
      // Mock delay to simulate backend response
      setTimeout(() => {
        setClarificationQuestions(MOCK_CLARIFICATION_QUESTIONS);
        setShowClarificationBar(true);
        setCurrentSubjectIndex(0); // Reset index when showing new questions
      }, 1500);
    }
  };

  // Rotate through subjects with animation
  useEffect(() => {
    if (showClarificationBar && clarificationQuestions.length > 0) {
      const interval = setInterval(() => {
        setCurrentSubjectIndex((prevIndex) => 
          (prevIndex + 1) % clarificationQuestions.length
        );
      }, 4000); // Change subject every 4 seconds

      return () => clearInterval(interval);
    }
  }, [showClarificationBar, clarificationQuestions.length]);

  // Handle clarification form submission
  const handleClarificationSubmit = () => {
    // For now, just close the form and clear the clarification bar
    console.log('Clarification answers:', clarificationAnswers);
    setShowClarificationForm(false);
    setShowClarificationBar(false);
    setClarificationAnswers({});
  };

  // Handle skip clarification
  const handleSkipClarification = () => {
    setShowClarificationForm(false);
    setShowClarificationBar(false);
    setClarificationAnswers({});
  };

  return {
    clarifyMode,
    setClarifyMode,
    clarificationQuestions,
    showClarificationBar,
    currentSubjectIndex,
    showClarificationForm,
    clarificationAnswers,
    simulateClarificationRequest,
    handleClarificationSubmit,
    handleSkipClarification,
    setShowClarificationForm,
    setClarificationAnswers
  };
}