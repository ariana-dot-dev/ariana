import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Copy, Check, ChevronDown, ChevronRight } from 'lucide-react';
import Computer from '../ui/icons/Computer';
import { CopyableCommand } from './CopyableCommand';
import { cn } from '@/lib/utils';

interface MachineSpecsDialogProps {
  trigger?: React.ReactNode;
}

// Logo URLs using devicons CDN
const LOGOS: Record<string, string> = {
  python: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/python/python-original.svg',
  nodejs: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/nodejs/nodejs-original.svg',
  bun: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/bun/bun-original.svg',
  deno: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/denojs/denojs-original.svg',
  go: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/go/go-original.svg',
  rust: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/rust/rust-original.svg',
  elixir: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/elixir/elixir-original.svg',
  dotnet: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/dotnetcore/dotnetcore-original.svg',
  java: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/java/java-original.svg',
  r: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/r/r-original.svg',
  php: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/php/php-original.svg',
  kotlin: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/kotlin/kotlin-original.svg',
  ruby: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/ruby/ruby-original.svg',
  scala: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/scala/scala-original.svg',
  gradle: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/gradle/gradle-original.svg',
  git: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/git/git-original.svg',
  github: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/github/github-original.svg',
  docker: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/docker/docker-original.svg',
  cmake: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/cmake/cmake-original.svg',
  gcc: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/gcc/gcc-original.svg',
  sqlite: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/sqlite/sqlite-original.svg',
  postgresql: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/postgresql/postgresql-original.svg',
  mysql: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/mysql/mysql-original.svg',
  mariadb: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/mariadb/mariadb-original.svg',
};

interface ToolItem {
  id: string;
  name: string;
  version?: string;
  manager?: string;
  extras?: string;
  command?: string;
  commandDescription?: string;
  logo?: string;
  isDatabase?: boolean;
}

interface Category {
  id: string;
  name: string;
  items: ToolItem[];
}

const MACHINE_SPECS = {
  highlighted: [
    { id: 'python', name: 'Python', version: '3', logo: LOGOS.python, extras: 'poetry, uv' },
    { id: 'nodejs', name: 'Node.js', version: '20, 22, 24', logo: LOGOS.nodejs, command: 'nvm use <version>', commandDescription: 'Switch Node.js version (20, 22, 24 pre-installed)' },
    { id: 'go', name: 'Go', version: '1.23', logo: LOGOS.go },
    { id: 'rust', name: 'Rust', logo: LOGOS.rust, extras: 'rustup, cargo, rust-analyzer' },
    { id: 'docker', name: 'Docker', logo: LOGOS.docker },
    { id: 'github', name: 'GitHub CLI', logo: LOGOS.github, command: 'gh auth login', commandDescription: 'Authenticate with GitHub' },
    { id: 'claude', name: 'Claude Code', command: 'claude', commandDescription: 'AI coding assistant CLI' },
    { id: 'web-desktop', name: 'Web Desktop', command: 'start-web-desktop', commandDescription: 'Launch XFCE desktop with Chrome at http://SERVER_IP:6080/vnc.html' },
  ] as ToolItem[],

  categories: [
    {
      id: 'languages',
      name: 'Languages & Runtimes',
      items: [
        { id: 'python', name: 'Python 3', logo: LOGOS.python, extras: 'poetry, uv, pip' },
        { id: 'nodejs', name: 'Node.js', logo: LOGOS.nodejs, extras: 'nvm (20, 22, 24), npm, pnpm' },
        { id: 'bun', name: 'Bun', logo: LOGOS.bun },
        { id: 'deno', name: 'Deno', logo: LOGOS.deno },
        { id: 'go', name: 'Go 1.23', logo: LOGOS.go },
        { id: 'rust', name: 'Rust', logo: LOGOS.rust, extras: 'rustup, cargo, rust-analyzer' },
        { id: 'java', name: 'Java 11', logo: LOGOS.java, extras: 'Maven, Gradle 8.12' },
        { id: 'kotlin', name: 'Kotlin 2.1', logo: LOGOS.kotlin },
        { id: 'scala', name: 'Scala', logo: LOGOS.scala, extras: 'sbt' },
        { id: 'dotnet', name: '.NET 8', logo: LOGOS.dotnet },
        { id: 'elixir', name: 'Elixir', logo: LOGOS.elixir, extras: 'Erlang' },
        { id: 'php', name: 'PHP 8.4', logo: LOGOS.php, extras: 'Composer' },
        { id: 'ruby', name: 'Ruby 4', logo: LOGOS.ruby, extras: 'bundler, gem' },
        { id: 'r', name: 'R', logo: LOGOS.r },
      ],
    },
    {
      id: 'tools',
      name: 'Tools',
      items: [
        { id: 'docker', name: 'Docker', logo: LOGOS.docker, extras: 'docker-compose' },
        { id: 'git', name: 'Git', logo: LOGOS.git },
        { id: 'github-cli', name: 'GitHub CLI', logo: LOGOS.github },
        { id: 'claude', name: 'Claude Code CLI' },
        { id: 'gcc', name: 'GCC/G++', logo: LOGOS.gcc, extras: 'build-essential, cmake' },
        { id: 'sqlite', name: 'SQLite', logo: LOGOS.sqlite },
        { id: 'ffmpeg', name: 'ffmpeg' },
        { id: 'imagemagick', name: 'ImageMagick' },
      ],
    },
    {
      id: 'databases',
      name: 'Databases (via Docker)',
      items: [
        {
          id: 'postgresql',
          name: 'PostgreSQL',
          logo: LOGOS.postgresql,
          isDatabase: true,
          command: 'docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=pass postgres',
          commandDescription: 'Start PostgreSQL (port 5432, password: pass)',
        },
        {
          id: 'mysql',
          name: 'MySQL',
          logo: LOGOS.mysql,
          isDatabase: true,
          command: 'docker run -d -p 3306:3306 -e MYSQL_ROOT_PASSWORD=pass mysql',
          commandDescription: 'Start MySQL (port 3306, root password: pass)',
        },
      ],
    },
  ] as Category[],

  quickRef: {
    os: 'Ubuntu 24.04',
    user: 'ariana',
    ports: 'SSH (22), Agent (8911), Desktop (6080)',
    permissions: 'sudo, Docker',
  },
};

function generateSpecsText(): string {
  let text = 'AGENT COMPUTER DOCUMENTATION\n';
  text += '='.repeat(60) + '\n\n';
  text += 'QUICK REFERENCE\n';
  text += '-'.repeat(60) + '\n';
  text += `OS: ${MACHINE_SPECS.quickRef.os}\n`;
  text += `User: ${MACHINE_SPECS.quickRef.user}\n`;
  text += `Open Ports: ${MACHINE_SPECS.quickRef.ports}\n`;
  text += `Permissions: ${MACHINE_SPECS.quickRef.permissions}\n\n`;
  text += 'MOST COMMONLY USED TOOLS\n';
  text += '-'.repeat(60) + '\n';
  MACHINE_SPECS.highlighted.forEach((tool) => {
    text += `${tool.name} ${tool.version}\n`;
    if (tool.command) text += `  ${tool.command}\n`;
    text += '\n';
  });
  MACHINE_SPECS.categories.forEach((category) => {
    text += `\n${category.name.toUpperCase()}\n`;
    text += '-'.repeat(60) + '\n';
    category.items.forEach((item) => {
      text += `  ${item.name}`;
      if (item.version) text += ` ${item.version}`;
      if (item.command) text += `\n    ${item.command}`;
      text += '\n';
    });
    text += '\n';
  });
  return text;
}

export function MachineSpecsDialog({ trigger }: MachineSpecsDialogProps) {
  const [copied, setCopied] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['core-languages'])
  );

  const handleCopy = async () => {
    try {
      const text = generateSpecsText();
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="transparent" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground/70">
            <div className="w-3 h-3 mr-1">
              <Computer className="max-w-full max-h-full text-inherit" />
            </div>
            <div>Agent's Computer Documentation</div>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="w-3xl max-w-[97vw] max-h-[85vh] overflow-y-auto p-0">
        <div className="p-6 space-y-6">
          <DialogHeader className="p-0 pr-4">
            <div className="flex items-center justify-between">
              <DialogTitle className='!m-0'>Agent's Computer Documentation</DialogTitle>
              <Button variant="transparent" size="sm" onClick={handleCopy} className="h-8 gap-1.5 text-xs">
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy as Text
                  </>
                )}
              </Button>
            </div>
          </DialogHeader>

          {/* Quick Reference - Simple text list, no cards */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Quick Reference</h3>
            <div className="text-xs space-y-1.5">
              <div className="flex gap-2">
                <span className="text-muted-foreground min-w-[80px]">OS:</span>
                <span className="font-mono">{MACHINE_SPECS.quickRef.os}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground min-w-[80px]">User:</span>
                <span className="font-mono">{MACHINE_SPECS.quickRef.user}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground min-w-[80px]">Open Ports:</span>
                <span className="font-mono">{MACHINE_SPECS.quickRef.ports}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground min-w-[80px]">Permissions:</span>
                <span className="font-mono text-xs">{MACHINE_SPECS.quickRef.permissions}</span>
              </div>
            </div>
          </div>

          {/* Highlighted Tools Grid */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Most Commonly Used</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {MACHINE_SPECS.highlighted.map((tool) => {
                const hasCommand = !!tool.command;
                const content = (
                  <div className="p-4 rounded-md bg-background-darker/40 hover:bg-background-darker transition-colors h-full">
                    <div className="flex items-start gap-2.5">
                      {tool.logo && <img src={tool.logo} alt={tool.name} className="w-7 h-7 object-contain flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm truncate">{tool.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{tool.version}</div>
                      </div>
                    </div>
                  </div>
                );

                return hasCommand ? (
                  <DropdownMenu key={tool.id}>
                    <DropdownMenuTrigger asChild>
                      <button className="w-full text-left h-full">{content}</button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-80">
                      <div className="p-2 space-y-2">
                        {tool.commandDescription && (
                          <p className="text-xs text-muted-foreground">{tool.commandDescription}</p>
                        )}
                        <CopyableCommand command={tool.command || ''} />
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <div key={tool.id}>{content}</div>
                );
              })}
            </div>
          </div>

          {/* Collapsible Categories */}
          {MACHINE_SPECS.categories.map((category) => {
            const isCategoryExpanded = expandedCategories.has(category.id);
            return (
              <div key={category.id} className="space-y-3">
                <button
                  onClick={() => toggleCategory(category.id)}
                  className="flex items-center gap-2 text-sm font-semibold hover:text-foreground/80 transition-colors w-full"
                >
                  {isCategoryExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <span>{category.name}</span>
                  <span className="text-xs text-muted-foreground font-normal">
                    ({category.items.length} {category.items.length === 1 ? 'item' : 'items'})
                  </span>
                </button>

                {isCategoryExpanded && (
                  <div className={cn(
                    "grid gap-2",
                    category.id === 'databases'
                      ? "grid-cols-1"
                      : "grid-cols-2 md:grid-cols-3"
                  )}>
                    {category.items.map((item) => {
                      const hasCommand = !!item.command;
                      const content = (
                        <div className={cn(
                          "p-4 rounded-md bg-background-darker/40 transition-colors h-full",
                          hasCommand && !item.isDatabase && "hover:bg-background-darker"
                        )}>
                          <div className="flex items-start gap-2.5">
                            {item.logo && <img src={item.logo} alt={item.name} className="w-6 h-6 object-contain flex-shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-sm">{item.name}</div>
                              {item.version && <div className="text-xs text-muted-foreground font-mono">{item.version}</div>}
                              {item.manager && <div className="text-xs text-muted-foreground mt-0.5">via {item.manager}</div>}
                              {item.extras && <div className="text-xs text-muted-foreground mt-1">{item.extras}</div>}
                              {item.isDatabase && item.command && (
                                <div className="mt-2.5 space-y-2">
                                  {item.commandDescription && (
                                    <p className="text-xs text-muted-foreground">{item.commandDescription}</p>
                                  )}
                                  <CopyableCommand command={item.command} />
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );

                      return hasCommand && !item.isDatabase ? (
                        <DropdownMenu key={item.id}>
                          <DropdownMenuTrigger asChild>
                            <button className="w-full text-left h-full">{content}</button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-80">
                            <div className="p-2 space-y-2">
                              {item.commandDescription && (
                                <p className="text-xs text-muted-foreground">{item.commandDescription}</p>
                              )}
                              <CopyableCommand command={item.command || ''} />
                            </div>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <div key={item.id} className="h-full">{content}</div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
