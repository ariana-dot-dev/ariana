import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { IDisposable } from "@xterm/xterm";
import { Terminal as XTerm } from "@xterm/xterm";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { TerminalService } from "./TerminalService";
import { useAppStore } from "@/stores/useAppStore";

interface CommandStep {
    command: string;
    delay: number; // milliseconds to wait after sending command
}

interface TerminalProps {
    terminalId: string;
    initialCommand?: string;
    commandSequence?: CommandStep[];
    className?: string;
    isVisible?: boolean;
}

const TerminalComponent: React.FC<TerminalProps> = ({
    terminalId,
    initialCommand,
    commandSequence,
    className,
    isVisible = true
}) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const dataDisposableRef = useRef<IDisposable | null>(null);
    const resizeDisposableRef = useRef<IDisposable | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [connectionId, setConnectionId] = useState<string | undefined>(undefined);
    const globalFontSize = useAppStore(state => state.globalFontSize);

    // Initialize terminal
    useEffect(() => {
        if (!terminalRef.current || xtermRef.current) return;


        const updateTheme = () => {
            if (!xtermRef.current) return;

            const cssVars = getComputedStyle(document.documentElement);
            const theme = {
                background: 'transparent',
                foreground: cssVars.getPropertyValue('--foreground'),
                cursor: cssVars.getPropertyValue('--foreground'),
                selectionBackground: cssVars.getPropertyValue('--secondary'),
                selectionForeground: cssVars.getPropertyValue('--muted-foreground'),
                black: cssVars.getPropertyValue('--muted-foreground'),
                red: cssVars.getPropertyValue('--destructive'),
                green: cssVars.getPropertyValue('--chart-2'),
                yellow: cssVars.getPropertyValue('--chart-4'),
                blue: cssVars.getPropertyValue('--muted'),
                magenta: cssVars.getPropertyValue('--chart-3'),
                cyan: cssVars.getPropertyValue('--chart-5'),
                white: cssVars.getPropertyValue('--foreground'),
                brightBlack: cssVars.getPropertyValue('--muted-foreground'),
                brightRed: cssVars.getPropertyValue('--destructive'),
                brightGreen: cssVars.getPropertyValue('--chart-2'),
                brightYellow: cssVars.getPropertyValue('--chart-4'),
                brightBlue: cssVars.getPropertyValue('--muted'),
                brightMagenta: cssVars.getPropertyValue('--chart-3'),
                brightCyan: cssVars.getPropertyValue('--chart-5'),
                brightWhite: cssVars.getPropertyValue('--foreground'),
            };

            xtermRef.current.options.theme = theme;
        };

        const cssVars = getComputedStyle(document.documentElement);
        const theme = {
            background: 'transparent',
            foreground: cssVars.getPropertyValue('--foreground'),
            cursor: cssVars.getPropertyValue('--foreground'),
            selectionBackground: cssVars.getPropertyValue('--secondary'),
            selectionForeground: cssVars.getPropertyValue('--muted-foreground'),
            black: cssVars.getPropertyValue('--muted-foreground'),
            red: cssVars.getPropertyValue('--destructive'),
            green: cssVars.getPropertyValue('--chart-2'),
            yellow: cssVars.getPropertyValue('--chart-4'),
            blue: cssVars.getPropertyValue('--muted'),
            magenta: cssVars.getPropertyValue('--chart-3'),
            cyan: cssVars.getPropertyValue('--chart-5'),
            white: cssVars.getPropertyValue('--foreground'),
            brightBlack: cssVars.getPropertyValue('--muted-foreground'),
            brightRed: cssVars.getPropertyValue('--destructive'),
            brightGreen: cssVars.getPropertyValue('--chart-2'),
            brightYellow: cssVars.getPropertyValue('--chart-4'),
            brightBlue: cssVars.getPropertyValue('--muted'),
            brightMagenta: cssVars.getPropertyValue('--chart-3'),
            brightCyan: cssVars.getPropertyValue('--chart-5'),
            brightWhite: cssVars.getPropertyValue('--foreground'),
        } as const;

        const xterm = new XTerm({
            theme,
            fontSize: globalFontSize,
            fontFamily: 'Work Sans Code, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace',
            cursorBlink: true,
            allowTransparency: true,
            allowProposedApi: true,
            fontWeight: "normal",
            fontWeightBold: "bold",
            minimumContrastRatio: 1,
            scrollback: 10000,
        });

        const fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon();
        const searchAddon = new SearchAddon();
        const imageAddon = new ImageAddon({
            enableSizeReports: true,
            sixelSupport: true,
            sixelScrolling: true,
            iipSupport: true,
            pixelLimit: 16777216,
            showPlaceholder: true,
        });

        xterm.loadAddon(fitAddon);
        xterm.loadAddon(webLinksAddon);
        xterm.loadAddon(searchAddon);
        xterm.loadAddon(imageAddon);

        xterm.open(terminalRef.current);

        // Clipboard integration
        xterm.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
            if (ev.type !== "keydown") {
                return true;
            }

            // Ctrl+C for copy (only when text is selected)
            if (ev.ctrlKey && ev.key === "c" && !ev.altKey && !ev.metaKey) {
                const sel = xterm.getSelection();
                if (sel) {
                    navigator.clipboard.writeText(sel).catch(() => {});
                    return false;
                }
                return true; // Pass through for terminal interrupt
            }

            // Ctrl+V for paste - use XTerm's built-in paste method
            if (ev.ctrlKey && ev.key === "v" && !ev.altKey && !ev.metaKey) {
                navigator.clipboard.readText().then((text) => {
                    if (text) {
                        xterm.paste(text);
                    }
                }).catch(() => {});
                return false;
            }

            return true;
        });

        xtermRef.current = xterm;
        fitAddonRef.current = fitAddon;

        // Connect to terminal service
        const connectTerminal = async () => {
            if (!xtermRef.current) return;

            try {
                let currentConnectionId = connectionId;
                if (!terminalId) {
                    return
                }
                currentConnectionId = await TerminalService.createConnection(terminalId);
                setConnectionId(currentConnectionId);

                setIsConnected(true);

                // Set up data handler
                dataDisposableRef.current?.dispose();
                const dataDisposable = xtermRef.current.onData((data) => {
                    if (currentConnectionId) {
                        TerminalService.sendData(currentConnectionId, data);
                    }
                });
                dataDisposableRef.current = dataDisposable;

                // Handle resize
                resizeDisposableRef.current?.dispose();
                const resizeDisposable = xtermRef.current.onResize(({ cols, rows }) => {
                    if (currentConnectionId) {
                        TerminalService.resizeTerminal(currentConnectionId, cols, rows);
                    }
                });
                resizeDisposableRef.current = resizeDisposable;

                // Listen for data from backend
                const handleData = (data: string) => {
                    xtermRef.current?.write(data);
                };

                const handleDisconnect = () => {
                    setIsConnected(false);
                    xtermRef.current?.write("\r\n\x1b[31mConnection lost\x1b[0m\r\n");
                    dataDisposableRef.current?.dispose();

                    setTimeout(() => {
                        TerminalService.cleanupDeadConnections();
                    }, 1000);
                };

                TerminalService.onData(currentConnectionId, handleData);
                TerminalService.onDisconnect(currentConnectionId, handleDisconnect);

                // Execute initial command or command sequence
                if (initialCommand) {
                    setTimeout(() => {
                        if (currentConnectionId) {
                            TerminalService.sendData(currentConnectionId, initialCommand + '\r');
                        }
                    }, 500);
                } else if (commandSequence && commandSequence.length > 0) {
                    // Execute command sequence
                    const executeSequence = async () => {
                        if (!currentConnectionId || !terminalId) return;
                        
                        for (const step of commandSequence) {
                            TerminalService.sendData(currentConnectionId, step.command);
                            await new Promise(resolve => setTimeout(resolve, step.delay));
                        }
                    };
                    
                    setTimeout(executeSequence, 500);
                }
            } catch (error) {
                console.error("Failed to set up terminal:", error);
                xtermRef.current?.write(`\x1b[31mTerminal error: ${error}\x1b[0m\r\n`);
            }
        };

        connectTerminal();

        // Initial fit after connection is established
        setTimeout(() => {
            if (fitAddonRef.current && xtermRef.current) {
                fitAddonRef.current.fit();
                if (connectionId && xtermRef.current.cols && xtermRef.current.rows) {
                    TerminalService.resizeTerminal(connectionId, xtermRef.current.cols, xtermRef.current.rows);
                }
            }
        }, 200);

        // Set up theme observer
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' &&
                    (mutation.attributeName === 'class' || mutation.attributeName === 'style')) {
                    updateTheme();
                }
            });
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class', 'style']
        });

        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['class', 'style']
        });

        return () => {
            dataDisposableRef.current?.dispose();
            dataDisposableRef.current = null;

            if (xtermRef.current) {
                xtermRef.current.dispose();
                xtermRef.current = null;
            }

            observer.disconnect();

            if (fitAddonRef.current) {
                fitAddonRef.current.dispose();
                fitAddonRef.current = null;
            }
        };
    }, [terminalId]);

    // Handle resize events - only when visible
    useEffect(() => {
        if (!fitAddonRef.current || !xtermRef.current || !connectionId || !isVisible) return;

        const handleResize = () => {
            // Skip resize if terminal is not visible - calling fit() on display:none corrupts xterm
            if (!isVisible) return;

            setTimeout(() => {
                if (!isVisible) return;
                fitAddonRef.current?.fit();
                if (xtermRef.current) {
                    TerminalService.resizeTerminal(connectionId, xtermRef.current.cols, xtermRef.current.rows);
                }
            }, 100);
        };

        let resizeObserver: ResizeObserver | null = null;
        if (terminalRef.current) {
            resizeObserver = new ResizeObserver(handleResize);
            resizeObserver.observe(terminalRef.current);
        }

        window.addEventListener('resize', handleResize);

        return () => {
            if (resizeObserver) {
                resizeObserver.disconnect();
            }
            window.removeEventListener('resize', handleResize);
        };
    }, [terminalId, connectionId, isVisible]);

    // Fit terminal when connection is established - only if visible
    useEffect(() => {
        if (fitAddonRef.current && connectionId && xtermRef.current && isVisible) {
            setTimeout(() => {
                if (!isVisible) return;
                fitAddonRef.current?.fit();
                TerminalService.resizeTerminal(connectionId, xtermRef.current!.cols, xtermRef.current!.rows);
            }, 500);
        }
    }, [connectionId, isVisible]);

    // Resize terminal when visibility changes
    useEffect(() => {
        if (isVisible && fitAddonRef.current && connectionId && xtermRef.current) {
            // Use requestAnimationFrame to ensure DOM is fully rendered before measuring
            requestAnimationFrame(() => {
                if (!isVisible || !fitAddonRef.current || !xtermRef.current) return;

                // Fit the terminal to container
                fitAddonRef.current.fit();

                // Scroll to bottom to show current cursor position
                xtermRef.current.scrollToBottom();

                // Notify backend of new size
                TerminalService.resizeTerminal(connectionId, xtermRef.current.cols, xtermRef.current.rows);
            });
        }
    }, [isVisible, connectionId]);

    // Update terminal font size when globalFontSize changes - only fit when visible
    useEffect(() => {
        if (xtermRef.current && fitAddonRef.current) {
            xtermRef.current.options.fontSize = globalFontSize;
            // Only call fit() if terminal is visible - calling fit() on display:none corrupts xterm
            if (isVisible) {
                fitAddonRef.current.fit();
                if (connectionId) {
                    TerminalService.resizeTerminal(connectionId, xtermRef.current.cols, xtermRef.current.rows);
                }
            }
        }
    }, [globalFontSize, connectionId, isVisible]);

    return (
        <div className={`flex flex-col h-full pl-4 py-3 overflow-y-scroll ${className}`}>
            <div
                ref={terminalRef}
                data-terminal-id={terminalId}
                className="h-full w-full pointer-events-auto"
            />
        </div>
    );
};

export default TerminalComponent;