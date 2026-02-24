import { useState, useCallback, useMemo, useEffect } from 'react';
import { css } from '@emotion/css';
import * as Prism from 'prismjs';
import isHotkey from 'is-hotkey';
import { Editor, Transforms, createEditor, Descendant, NodeEntry, Range, Text, Element as SlateElement } from 'slate';
import { Slate, Editable, withReact, RenderLeafProps, RenderElementProps, ReactEditor } from 'slate-react';
import { withHistory } from 'slate-history';
import { cn } from '@/lib/utils';
import { useTheme } from '@/hooks/useTheme';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Define custom .env grammar for Prism
Prism.languages.dotenv = {
  'comment': {
    pattern: /#.*/,
    greedy: true
  },
  'key': {
    pattern: /^[\w.-]+(?==)/m,
    alias: 'attr-name'
  },
  'punctuation': /=/,
  'value': {
    pattern: /=.*/,
    inside: {
      'punctuation': /^=/,
      'string': {
        pattern: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/,
        greedy: true
      },
      'variable': {
        pattern: /\$\{[^}]+\}|\$\w+/,
        alias: 'constant'
      }
    }
  }
};

// Prism theme CSS for light mode
const prismThemeLight = css`
  .token.comment {
    color: #6a737d;
    font-style: italic;
  }

  .token.punctuation {
    color: #999;
  }

  .token.attr-name,
  .token.key {
    color: #005cc5;
    font-weight: 600;
  }

  .token.string {
    color: #032f62;
  }

  .token.variable,
  .token.constant {
    color: #e36209;
  }
`;

// Prism theme CSS for dark mode
const prismThemeDark = css`
  .token.comment {
    color: #6a9955;
    font-style: italic;
  }

  .token.punctuation {
    color: #d4d4d4;
  }

  .token.attr-name,
  .token.key {
    color: #9cdcfe;
    font-weight: 600;
  }

  .token.string {
    color: #ce9178;
  }

  .token.variable,
  .token.constant {
    color: #4ec9b0;
  }
`;

interface EnvEditorProps {
  value: string;
  onChange: (value: string) => void;
}

// Normalize tokens from Prism into a flat structure
function normalizeTokens(tokens: (string | Prism.Token)[]): Array<{ types: string[]; content: string }> {
  const normalized: Array<{ types: string[]; content: string }> = [];

  function flatten(tokens: (string | Prism.Token)[], types: string[] = []): void {
    for (const token of tokens) {
      if (typeof token === 'string') {
        normalized.push({ types, content: token });
      } else {
        const newTypes = [...types, token.type];
        if (typeof token.content === 'string') {
          normalized.push({ types: newTypes, content: token.content });
        } else if (Array.isArray(token.content)) {
          flatten(token.content, newTypes);
        } else if (token.content && typeof token.content === 'object' && 'content' in token.content) {
          flatten([token.content as Prism.Token], newTypes);
        }
      }
    }
  }

  flatten(tokens);
  return normalized;
}

// Convert string to Slate value (one element per line)
function stringToSlateValue(text: string): Descendant[] {
  const lines = text.split('\n');
  return lines.map(line => ({
    type: 'code-line' as const,
    children: [{ text: line }]
  }));
}

// Convert Slate value back to string
function slateValueToString(value: Descendant[]): string {
  return value.map(node => {
    if (SlateElement.isElement(node)) {
      return node.children.map((child: any) => child.text || '').join('');
    }
    return '';
  }).join('\n');
}

export function EnvEditor({ value, onChange }: EnvEditorProps) {
  const { isDark } = useTheme();
  const [copied, setCopied] = useState(false);

  // Create editor instance
  const editor = useMemo(() => withHistory(withReact(createEditor())), []);

  // Initialize editor value from string
  const initialValue: Descendant[] = useMemo(() => {
    return stringToSlateValue(value);
  }, []);

  // Set initial value once
  useEffect(() => {
    editor.children = initialValue;
    Editor.normalize(editor, { force: true });
  }, [editor]);

  // Decorate function for syntax highlighting
  const decorate = useCallback(([node, path]: NodeEntry) => {
    const ranges: Range[] = [];

    if (!Text.isText(node)) {
      return ranges;
    }

    const text = node.text;
    if (!text) {
      return ranges;
    }

    try {
      const tokens = Prism.tokenize(text, Prism.languages.dotenv);
      const normalizedTokens = normalizeTokens(tokens);

      let start = 0;
      for (const token of normalizedTokens) {
        const length = token.content.length;
        if (!length) {
          continue;
        }

        const end = start + length;

        ranges.push({
          anchor: { path, offset: start },
          focus: { path, offset: end },
          ...Object.fromEntries(token.types.map(type => [type, true]))
        });

        start = end;
      }
    } catch (e) {
      // If tokenization fails, return empty ranges
    }

    return ranges;
  }, []);

  // Calculate the width needed for line numbers (minimum 3 characters)
  const lineCount = value.split('\n').length;
  const maxDigits = Math.max(3, String(lineCount).length);

  // Render element with line numbers
  const renderElement = useCallback((props: RenderElementProps) => {
    const { attributes, children, element } = props;
    const path = ReactEditor.findPath(editor, element);
    const lineNumber = path[0] + 1;

    return (
      <div {...attributes} className="flex">
        <span
          contentEditable={false}
          className="select-none text-muted-foreground/50 pr-3 flex-shrink-0 font-mono text-right user-select-none"
          style={{
            minWidth: '3ch',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            MozUserSelect: 'none',
            msUserSelect: 'none'
          }}
          data-slate-void="true"
          suppressContentEditableWarning
        >
          {lineNumber}
        </span>
        <span className="flex-1 min-w-0">{children}</span>
      </div>
    );
  }, [editor]);

  // Render leaf with token styles
  const renderLeaf = useCallback((props: RenderLeafProps) => {
    const { attributes, children, leaf } = props;
    return (
      <span {...attributes} className={getTokenClassName(leaf)}>
        {children}
      </span>
    );
  }, []);

  // Get className for token types
  function getTokenClassName(leaf: any): string {
    const classes: string[] = [];
    Object.keys(leaf).forEach(key => {
      if (key !== 'text' && leaf[key] === true) {
        classes.push(`token ${key}`);
      }
    });
    return classes.join(' ');
  }

  // Handle value change
  const handleChange = useCallback((newValue: Descendant[]) => {
    const text = slateValueToString(newValue);
    onChange(text);
  }, [onChange]);

  // Handle copy
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  // Handle keyboard events (Tab key for indentation)
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (isHotkey('tab', event as any)) {
      event.preventDefault();
      Editor.insertText(editor, '  '); // Insert 2 spaces
    }
  }, [editor]);

  // Apply theme class dynamically based on isDark
  const themeClass = isDark ? prismThemeDark : prismThemeLight;

  return (
    <div className="flex flex-col gap-3" key={isDark ? 'dark' : 'light'}>
      {/* Editor */}
      <div
        className={cn(
          'overflow-auto rounded-md bg-muted/30',
          'min-h-[15ch]',
          themeClass
        )}
      >
        <div className="p-3">
          <Slate editor={editor} initialValue={initialValue} onChange={handleChange}>
            <Editable
              decorate={decorate}
              renderElement={renderElement}
              renderLeaf={renderLeaf}
              onKeyDown={handleKeyDown}
              placeholder="KEY=value&#10;ANOTHER_KEY=another value&#10;API_URL=https://api.example.com"
              spellCheck={false}
              className={cn(
                'font-mono text-sm outline-none min-h-full',
                'whitespace-pre',
                'text-foreground'
              )}
              style={{
                caretColor: 'currentColor',
                lineHeight: '1.5'
              }}
            />
          </Slate>
        </div>
      </div>

      {/* Footer with hint and copy button */}
      <div className="flex items-center justify-between">
        {/* Hint text */}
        <p className="text-xs text-muted-foreground">
          Format: KEY=value, one per line. Supports comments (#) and empty lines.
        </p>

        {/* Copy button */}
        <Button
          size="sm"
          variant="background"
          onClick={handleCopy}
          className="gap-2"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
