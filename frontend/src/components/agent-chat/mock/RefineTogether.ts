export interface ClarificationQuestion {
    subject: string;
    description: string;
}

export const MOCK_CLARIFICATION_QUESTIONS: ClarificationQuestion[] = [
    {
        subject: "API /message endpoint",
        description: "Is this a POST with a body, or a GET with a query parameter? How should I implement this?"
    },
    {
        subject: "Authentication method",
        description: "What type of authentication are you using - JWT tokens, session cookies, or API keys?"
    },
    {
        subject: "Database schema",
        description: "Should the user table include profile information or keep it separate in a profiles table?"
    }
];