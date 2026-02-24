import { Hono } from 'hono'
import { encryption } from '../cryptoSingleton';
import { globalState } from '../agentsState';
import type {
    FileContentResult,
    FileEditResult,
    BashOutputResult,
    WebSearchResult,
    WebFetchResult,
    TodoWriteResult,
    TaskResult,
    GenericToolResult,
    FileWriteResult,
    GrepResult,
    GlobResult
} from '../types/tool-result-formats';

const app = new Hono()


function transformToolResult(toolUse: ToolUse, toolUseResult: { content: string, is_error: boolean } | undefined): string {
    let structuredResult: any;

    switch (toolUse.name) {
        case 'Read':
            structuredResult = transformRead(toolUse, toolUseResult);
            break;
        case 'Edit':
        case 'MultiEdit':
            structuredResult = transformEdit(toolUse, toolUseResult);
            break;
        case 'Write':
            structuredResult = transformWrite(toolUse, toolUseResult);
            break;
        case 'Bash':
            structuredResult = transformBash(toolUse, toolUseResult);
            break;
        case 'Grep':
            structuredResult = transformGrep(toolUse, toolUseResult);
            break;
        case 'Glob':
            structuredResult = transformGlob(toolUse, toolUseResult);
            break;
        case 'WebSearch':
            structuredResult = transformWebSearch(toolUse, toolUseResult);
            break;
        case 'WebFetch':
            structuredResult = transformWebFetch(toolUse, toolUseResult);
            break;
        case 'TodoWrite':
            structuredResult = transformTodoWrite(toolUse, toolUseResult);
            break;
        case 'Task':
            structuredResult = transformTask(toolUse, toolUseResult);
            break;
        default:
            // Log Skill tool invocations to understand SDK output format
            if (toolUse.name === 'Skill') {
                console.log('[Conversations] Skill tool invoked:', JSON.stringify({
                    toolUse,
                    toolUseResult,
                    hasResult: !!toolUseResult,
                    resultContent: toolUseResult?.content?.substring(0, 500)
                }, null, 2));
            }
            structuredResult = transformGeneric(toolUse, toolUseResult);
            break;
    }

    return JSON.stringify(structuredResult);
}

function transformRead(toolUse: ToolUse, toolUseResult: { content: string, is_error: boolean } | undefined): FileContentResult {
    const filePath = toolUse.input?.file_path || '';
    const fileName = filePath.split('/').pop() || '';
    const language = getLanguageFromPath(filePath);

    if (toolUseResult) {
        // Handle binary files (images, PDFs, etc.) where content is not a string
        if (typeof toolUseResult.content !== 'string') {
            return {
                type: 'file_content',
                pending: false,
                filePath: filePath,
                fileName: fileName,
                language: language,
                totalLines: 0,
                lines: [],
                isBinary: true
            };
        }

        // Completed: has file content
        const file = toolUseResult.content.split('\n<system-reminder>\nWhenever you')[0];
        const startLine = file.split('\n')[0] ? Number.parseInt(file.split('\n')[0].trimStart().split('→')[0]) : 1;
        const lines = file.split('\n').map((line: string, index: number) => {
            return {
                number: startLine + index,
                content: line.trimStart().split('→')[1]
            }
        });

        return {
            type: 'file_content',
            pending: false,
            filePath: filePath,
            fileName: fileName,
            language: getLanguageFromPath(filePath),
            totalLines: -1,
            lines
        };
    } else {
        // Pending: only have input
        return {
            type: 'file_content',
            pending: true,
            filePath,
            fileName,
            language,
            totalLines: 0,
            lines: []
        };
    }
}

function transformEdit(toolUse: ToolUse, toolUseResult: { content: string, is_error: boolean } | undefined): FileEditResult {
    const isMultiEdit = toolUse.name === 'MultiEdit';
    const filePath = toolUse.input?.file_path || '';
    const fileName = filePath.split('/').pop() || '';
    const editsCount = isMultiEdit ? (toolUse.input?.edits?.length || 0) : 1;
    const oldString = toolUse.input?.old_string || '';
    const newString = toolUse.input?.new_string || '';

    if (toolUseResult) {
        return {
            type: 'file_edit',
            pending: false,
            filePath: filePath,
            fileName: filePath.split('/').pop() || '',
            isMultiEdit,
            editsCount,
            oldString,
            newString
        };
    } else {
        // Pending: only have input
        return {
            type: 'file_edit',
            pending: true,
            filePath,
            fileName,
            isMultiEdit,
            editsCount,
            oldString,
            newString
        };
    }
}

function transformWrite(toolUse: ToolUse, toolUseResult: { content: string, is_error: boolean } | undefined): FileWriteResult {
    const filePath = toolUse.input?.file_path || '';
    const fileName = filePath.split('/').pop() || '';

    if (toolUseResult) {
        return {
            type: 'file_write',
            pending: false,
            filePath,
            fileName,
            content: toolUse.input?.content || ''
        };
    } else {
        // Pending: only have input
        return {
            type: 'file_write',
            pending: true,
            filePath,
            fileName,
            content: toolUse.input?.content || ''
        };
    }
}

function transformBash(toolUse: ToolUse, toolUseResult: { content: string, is_error: boolean } | undefined): BashOutputResult {
    const command = toolUse.input?.command || '';
    const description = toolUse.input?.description || '';

    if (toolUseResult) {
        // Completed: has output
        return {
            type: 'bash_output',
            pending: false,
            command,
            description,
            content: toolUseResult.content || '',
            error: toolUseResult.is_error || false
        };
    } else {
        // Pending: only have input
        return {
            type: 'bash_output',
            pending: true,
            command,
            description,
            content: '',
            error: false
        };
    }
}

function transformGrep(toolUse: ToolUse, toolUseResult: { content: string, is_error: boolean } | undefined): GrepResult {
    const pattern = toolUse.input?.pattern || '';
    const glob = toolUse.input?.glob || '';
    const path = toolUse.input?.path || '';

    if (toolUseResult) {
        // Completed: has results
        return {
            type: 'grep_result',
            pending: false,
            pattern,
            glob,
            path,
            content: toolUseResult.content || ''
        };
    } else {
        // Pending: only have input
        return {
            type: 'grep_result',
            pending: true,
            pattern,
            glob,
            path,
            content: ''
        };
    }
}

function transformGlob(toolUse: ToolUse, toolUseResult: { content: string, is_error: boolean } | undefined): GlobResult {
    const pattern = toolUse.input?.pattern || '';
    const path = toolUse.input?.path || '';

    if (toolUseResult) {
        return {
            type: 'glob_result',
            pending: false,
            path,
            glob: pattern,
            content: toolUseResult.content || ''
        };
    } else {
        return {
            type: 'glob_result',
            pending: true,
            path,
            glob: pattern,
            content: ''
        };
    }
}

function transformWebSearch(toolUse: ToolUse, toolUseResult: { content: string, is_error: boolean } | undefined): WebSearchResult {
    const query = toolUse.input?.query || '';

    if (toolUseResult) {
        return {
            type: 'web_search',
            pending: false,
            query,
            content: toolUseResult.content || ''
        };
    } else {
        return {
            type: 'web_search',
            pending: true,
            query,
            content: ''
        };
    }
}

function transformWebFetch(toolUse: ToolUse, toolUseResult: { content: string, is_error: boolean } | undefined): WebFetchResult {
    const url = toolUse.input?.url || '';

    if (toolUseResult) {
        return {
            type: 'web_fetch',
            pending: false,
            url,
            prompt: toolUse.input?.prompt || '',
            content: toolUseResult.content || ''
        };
    } else {
        return {
            type: 'web_fetch',
            pending: true,
            url,
            prompt: toolUse.input?.prompt || '',
            content: ''
        };
    }
}

function transformTodoWrite(toolUse: ToolUse, toolUseResult: { content: string, is_error: boolean } | undefined): TodoWriteResult {
    return {
        type: 'todo_write',
        pending: false,
        todos: toolUse.input?.todos.map((todo: any) => ({ 
            content: todo.content,
            state: todo.status === 'completed' ? 'completed' : (
                todo.status === 'in_progress' ? 'pending' : 'pending' // TODO not-pending state?
            )
        })) || []
    };
}

function transformTask(toolUse: ToolUse, toolUseResult: { content: string, is_error: boolean } | undefined): TaskResult {
    const description = toolUse.input?.description || '';
    const subagentType = toolUse.input?.subagent_type || '';
    const prompt = toolUse.input?.prompt || '';

    return {
        type: 'task',
        pending: !toolUseResult,
        description,
        subagentType,
        prompt,
        result: toolUseResult ? 'Task completed' : ''
    };
}

function transformGeneric(toolUse: ToolUse, toolUseResult: { content: string, is_error: boolean } | undefined): GenericToolResult {
    return {
        type: 'generic_tool',
        pending: !toolUseResult,
        toolName: toolUse.name,
        output: toolUseResult ? toolUseResult.content : ''
    };
}

function getLanguageFromPath(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
        'ts': 'typescript',
        'tsx': 'typescript',
        'js': 'javascript',
        'jsx': 'javascript',
        'py': 'python',
        'rs': 'rust',
        'go': 'go',
        'java': 'java',
        'cpp': 'cpp',
        'c': 'c',
        'sh': 'bash',
        'md': 'markdown',
        'json': 'json',
        'yaml': 'yaml',
        'yml': 'yaml',
        'toml': 'toml',
        'ex': 'elixir',
        'exs': 'elixir',
    };
    return langMap[ext || ''] || 'text';
}

interface ConversationMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    model?: string;
    timestamp: number;
    tools?: Array<{
        use: ToolUse;
        result?: ToolResult;
    }>;
    isStreaming?: boolean;
}

interface ToolUse {
    type: 'tool_use';
    id: string;
    name: string;
    input?: any;
}

interface ToolResult {
    type: 'tool_result';
    tool_use_id: string;
    content: string;
    is_error?: boolean;
    error?: string;
}

app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<{}>(body);

    if (!valid) {
        console.log('Invalid data in ' + c.req.path, "\nbody: ", body, "\ndata: ", data, "\nerror: ", error)
        return c.json({ error }, 400);
    }

    if (!globalState.claudeService) {
        console.log('Claude service not initialized yet, no messages');
        const response = {
            success: true,
            messages: [],
            totalMessages: 0
        }
        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });
    }

    let messages = await globalState.claudeService?.getMessages();

    const toolUseToResultMap = new Map<string, { content: string, is_error: boolean }>();

    // Collect tool results with their metadata
    messages.forEach((msg: any) => {
        if (msg.type === 'user' && 'message' in msg) {
            const userMsg = msg.message as any;
            if (userMsg.role === 'user' && Array.isArray(userMsg.content)) {
                userMsg.content.forEach((block: any) => {
                    if (block.type === 'tool_result') {
                        toolUseToResultMap.set(block.tool_use_id, { content: block.content, is_error: !!block.is_error });
                    }
                });
            }
        }
    });

    let formattedMessages: ConversationMessage[] = [];

    messages.forEach((msg: any) => {
        if (msg.type === 'assistant') {
            const textBlocks: string[] = [];
            const tools: Array<{ use: ToolUse; result: ToolResult }> = [];

            msg.message.content.forEach((block: any) => {
                if (block.type === 'text') {
                    textBlocks.push(block.text);
                } else if (block.type === 'tool_use') {
                    const toolUse: ToolUse = {
                        type: 'tool_use',
                        id: block.id,
                        name: block.name,
                        input: block.input
                    };

                    const toolUseResult = toolUseToResultMap.get(block.id);
                    const transformedContent = transformToolResult(toolUse, toolUseResult);

                    tools.push({
                        use: toolUse,
                        result: {
                            type: 'tool_result',
                            tool_use_id: block.id,
                            content: transformedContent,
                            is_error: toolUseResult?.is_error
                        }
                    });
                }
            });

            const content = textBlocks.join('\n').trim();

            if (content || tools.length > 0) {
                formattedMessages.push({
                    id: msg.uuid.toString(),
                    role: 'assistant',
                    content: content || '',
                    model: msg.message.model,
                    timestamp: msg.timestamp.getTime(),
                    tools: tools.length > 0 ? tools : undefined,
                    ...(msg.isStreaming ? { isStreaming: true } : {})
                });
            }
        } else if (msg.type === 'user' && typeof msg.message === 'string') {
            // Filter out messages with <system-hide-in-chat> tags
            if (msg.message.includes('<system-hide-in-chat>')) {
                return; // Skip this message
            }

            formattedMessages.push({
                id: msg.uuid.toString(),
                role: 'user',
                content: msg.message,
                timestamp: msg.timestamp.getTime()
            });
        }
    });

    const response = {
        success: true,
        messages: formattedMessages,
        totalMessages: formattedMessages.length
    };

    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });
})

export default app;