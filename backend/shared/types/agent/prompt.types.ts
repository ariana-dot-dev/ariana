export interface Prompt {
    message: string;
    additionalPlainTextData: string | null;
    model?: 'opus' | 'sonnet' | 'haiku';
}