import { Highlight, themes, type PrismTheme } from 'prism-react-renderer';
import { cn } from '@/lib/utils';

interface SyntaxHighlightedCodeProps {
  code: string;
  language?: string;
  isDark?: boolean;
  className?: string;
  inline?: boolean;
}

/**
 * Create theme with transparent backgrounds to not interfere with diff backgrounds
 */
function createTransparentTheme(baseTheme: PrismTheme): PrismTheme {
  return {
    ...baseTheme,
    plain: {
      ...baseTheme.plain,
      backgroundColor: 'transparent',
      background: 'transparent',
    }
  };
}

/**
 * Component to render syntax-highlighted code.
 * Uses prism-react-renderer with appropriate theme based on dark/light mode.
 * Backgrounds are transparent to preserve diff line backgrounds.
 */
export function SyntaxHighlightedCode({
  code,
  language = 'text',
  isDark = false,
  className,
  inline = false
}: SyntaxHighlightedCodeProps) {
  const baseTheme = isDark ? themes.vsDark : themes.vsLight;
  const theme = createTransparentTheme(baseTheme);

  return (
    <Highlight
      theme={theme}
      code={code}
      language={language}
    >
      {({ tokens, getLineProps, getTokenProps }) => (
        inline ? (
          <span className={cn('font-mono', className)}>
            {tokens[0]?.map((token, key) => {
              const props = getTokenProps({ token });
              return (
                <span
                  key={key}
                  {...props}
                  style={{ ...props.style, backgroundColor: 'transparent' }}
                />
              );
            })}
          </span>
        ) : (
          <pre className={cn('font-mono whitespace-pre-wrap break-all', className)}>
            {tokens.map((line, i) => {
              const lineProps = getLineProps({ line });
              return (
                <div
                  key={i}
                  {...lineProps}
                  style={{ ...lineProps.style, backgroundColor: 'transparent' }}
                >
                  {line.map((token, key) => {
                    const tokenProps = getTokenProps({ token });
                    return (
                      <span
                        key={key}
                        {...tokenProps}
                        style={{ ...tokenProps.style, backgroundColor: 'transparent' }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </pre>
        )
      )}
    </Highlight>
  );
}

/**
 * Utility to detect language from file extension
 */
export function detectLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';

  const languageMap: Record<string, string> = {
    // JavaScript/TypeScript
    'js': 'javascript',
    'mjs': 'javascript',
    'cjs': 'javascript',
    'jsx': 'jsx',
    'ts': 'typescript',
    'mts': 'typescript',
    'cts': 'typescript',
    'tsx': 'tsx',

    // Web frameworks/templates
    'vue': 'markup', // Prism treats Vue as markup
    'svelte': 'markup', // Prism treats Svelte as markup
    'astro': 'markup',

    // Python
    'py': 'python',
    'pyw': 'python',
    'pyi': 'python',

    // Ruby
    'rb': 'ruby',
    'rake': 'ruby',

    // Go
    'go': 'go',

    // Rust
    'rs': 'rust',

    // Java/JVM
    'java': 'java',
    'kt': 'kotlin',
    'kts': 'kotlin',
    'scala': 'scala',
    'groovy': 'groovy',

    // C/C++
    'c': 'c',
    'cpp': 'cpp',
    'cc': 'cpp',
    'cxx': 'cpp',
    'c++': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
    'hxx': 'cpp',

    // C#/.NET
    'cs': 'csharp',
    'fs': 'fsharp',
    'fsx': 'fsharp',

    // PHP
    'php': 'php',
    'phtml': 'php',

    // Swift
    'swift': 'swift',

    // Shell scripting
    'sh': 'bash',
    'bash': 'bash',
    'zsh': 'bash',
    'fish': 'bash',
    'ps1': 'powershell',
    'psm1': 'powershell',
    'bat': 'batch',
    'cmd': 'batch',

    // Data/Config
    'json': 'json',
    'json5': 'json5',
    'jsonc': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'toml': 'toml',
    'xml': 'xml',
    'ini': 'ini',
    'cfg': 'ini',
    'conf': 'nginx', // Config files often use nginx syntax
    'env': 'bash',

    // Database
    'sql': 'sql',
    'prisma': 'javascript', // Prisma schema uses JS-like syntax

    // Web
    'html': 'markup',
    'htm': 'markup',
    'xhtml': 'markup',
    'svg': 'markup',
    'css': 'css',
    'scss': 'scss',
    'sass': 'sass',
    'less': 'less',

    // Documentation
    'md': 'markdown',
    'mdx': 'markdown',
    'markdown': 'markdown',
    'rst': 'rest',
    'tex': 'latex',

    // GraphQL
    'graphql': 'graphql',
    'gql': 'graphql',

    // Docker
    'dockerfile': 'docker',

    // Other languages
    'r': 'r',
    'vim': 'vim',
    'lua': 'lua',
    'pl': 'perl',
    'pm': 'perl',
    'ex': 'elixir',
    'exs': 'elixir',
    'erl': 'erlang',
    'clj': 'clojure',
    'cljs': 'clojure',
    'dart': 'dart',
    'elm': 'elm',
    'hs': 'haskell',
    'ml': 'ocaml',
    'jl': 'julia',
    'nim': 'nim',
    'cr': 'crystal',
    'v': 'v',
    'zig': 'zig',
    'diff': 'diff',
    'patch': 'diff',
    'makefile': 'makefile',
    'mk': 'makefile',
    'proto': 'protobuf',
    'wasm': 'wasm',
  };

  return languageMap[ext] || 'text';
}
