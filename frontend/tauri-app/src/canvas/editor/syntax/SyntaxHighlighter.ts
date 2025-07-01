// @ts-nocheck - web-tree-sitter types are not fully compatible

export interface Token {
	startIndex: number;
	endIndex: number;
	scopes: string[];
}

export interface HighlightedLine {
	tokens: Token[];
}

export class SyntaxHighlighter {
	private parser: any = null;
	private tsLanguage: any = null;
	private tsxLanguage: any = null;
	private tree: any = null;
	private isInitialized = false;
	private Parser: any = null;

	async initialize() {
		if (this.isInitialized) return;

		console.log("[SyntaxHighlighter] Starting initialization...");

		try {
			// dynamically import Parser to use at runtime
			const TreeSitterModule = await import("web-tree-sitter");
			console.log(
				"[SyntaxHighlighter] TreeSitter module loaded:",
				TreeSitterModule,
			);

			// Try to find Parser in the module
			this.Parser =
				TreeSitterModule.Parser ||
				TreeSitterModule.default?.Parser ||
				TreeSitterModule.default;
			const Language =
				TreeSitterModule.Language || TreeSitterModule.default?.Language;

			if (!this.Parser) {
				throw new Error("Could not find Parser in web-tree-sitter module");
			}

			if (!Language) {
				throw new Error("Could not find Language in web-tree-sitter module");
			}

			console.log("[SyntaxHighlighter] Parser found:", this.Parser);
			console.log("[SyntaxHighlighter] Language found:", Language);

			await this.Parser.init({
				locateFile(scriptName: string) {
					console.log("[SyntaxHighlighter] Locating file:", scriptName);
					return `/${scriptName}`;
				},
			});

			this.parser = new this.Parser();
			console.log("[SyntaxHighlighter] Parser instance created");

			// load typescript language
			console.log("[SyntaxHighlighter] Loading TypeScript grammar...");
			const tsLangFile = await fetch("/tree-sitter-typescript.wasm");
			const tsLangBytes = await tsLangFile.arrayBuffer();
			console.log(
				"[SyntaxHighlighter] TypeScript grammar loaded, size:",
				tsLangBytes.byteLength,
			);

			this.tsLanguage = await Language.load(new Uint8Array(tsLangBytes));

			// load tsx language
			console.log("[SyntaxHighlighter] Loading TSX grammar...");
			const tsxLangFile = await fetch("/tree-sitter-tsx.wasm");
			const tsxLangBytes = await tsxLangFile.arrayBuffer();
			console.log(
				"[SyntaxHighlighter] TSX grammar loaded, size:",
				tsxLangBytes.byteLength,
			);

			this.tsxLanguage = await Language.load(new Uint8Array(tsxLangBytes));

			// default to typescript
			this.parser.setLanguage(this.tsLanguage);
			this.isInitialized = true;
			console.log("[SyntaxHighlighter] Initialization complete");
		} catch (error) {
			console.error("[SyntaxHighlighter] Failed to initialize:", error);
			throw error;
		}
	}

	parseDocument(content: string): any {
		if (!this.parser || !this.isInitialized) {
			console.error("SyntaxHighlighter not initialized");
			return null;
		}

		try {
			this.tree = this.parser.parse(content);
			return this.tree;
		} catch (error) {
			console.error("Error parsing document:", error);
			return null;
		}
	}

	getHighlightedLines(
		content: string,
		fileName: string,
	): Map<number, HighlightedLine> {
		const lines = new Map<number, HighlightedLine>();

		// set appropriate language based on file extension
		if (this.parser && this.isInitialized) {
			const isTSX = fileName.endsWith(".tsx") || fileName.endsWith(".jsx");
			const language = isTSX ? this.tsxLanguage : this.tsLanguage;
			if (language) {
				console.log(
					`[SyntaxHighlighter] Using ${isTSX ? "TSX" : "TypeScript"} parser for ${fileName}`,
				);
				this.parser.setLanguage(language);
			}
		}

		const tree = this.parseDocument(content);

		if (!tree) return lines;

		const cursor = tree.walk();
		const contentLines = content.split("\n");

		// initialize lines
		for (let i = 0; i < contentLines.length; i++) {
			lines.set(i, { tokens: [] });
		}

		// traverse the syntax tree
		this.traverseTree(cursor, lines, content);

		return lines;
	}

	private traverseTree(
		cursor: any, // TreeCursor type is not exported
		lines: Map<number, HighlightedLine>,
		content: string,
	) {
		const visitNode = () => {
			const node = cursor.currentNode;
			const nodeType = node.type;
			const scopes = this.getScopes(nodeType, cursor);

			if (scopes.length > 0) {
				const startPos = node.startPosition;
				const endPos = node.endPosition;

				// add token to all lines it spans
				for (let line = startPos.row; line <= endPos.row; line++) {
					const lineData = lines.get(line);
					if (!lineData) continue;

					const lineStartIndex = this.getLineStartIndex(content, line);
					const lineEndIndex = this.getLineEndIndex(content, line);

					const tokenStartIndex = Math.max(node.startIndex - lineStartIndex, 0);
					const tokenEndIndex = Math.min(
						node.endIndex - lineStartIndex,
						lineEndIndex - lineStartIndex,
					);

					if (tokenStartIndex < tokenEndIndex) {
						lineData.tokens.push({
							startIndex: tokenStartIndex,
							endIndex: tokenEndIndex,
							scopes,
						});
					}
				}
			}

			// traverse children
			if (cursor.gotoFirstChild()) {
				do {
					visitNode();
				} while (cursor.gotoNextSibling());
				cursor.gotoParent();
			}
		};

		visitNode();
	}

	private getScopes(nodeType: string, cursor: any): string[] {
		const scopes: string[] = [];

		// typescript/javascript token mapping
		switch (nodeType) {
			// keywords
			case "const":
			case "let":
			case "var":
			case "function":
			case "class":
			case "interface":
			case "type":
			case "enum":
			case "if":
			case "else":
			case "for":
			case "while":
			case "do":
			case "switch":
			case "case":
			case "default":
			case "break":
			case "continue":
			case "return":
			case "throw":
			case "try":
			case "catch":
			case "finally":
			case "async":
			case "await":
			case "yield":
			case "import":
			case "export":
			case "from":
			case "as":
			case "new":
			case "delete":
			case "typeof":
			case "instanceof":
			case "void":
			case "this":
			case "super":
			case "static":
			case "public":
			case "private":
			case "protected":
			case "readonly":
			case "extends":
			case "implements":
				scopes.push("keyword");
				break;

			// literals
			case "string":
			case "template_string":
				scopes.push("string");
				break;

			case "number":
				scopes.push("number");
				break;

			case "true":
			case "false":
			case "null":
			case "undefined":
				scopes.push("constant");
				break;

			// comments
			case "comment":
			case "line_comment":
			case "block_comment":
				scopes.push("comment");
				break;

			// identifiers
			case "type_identifier":
			case "interface_declaration":
			case "class_declaration":
				scopes.push("type");
				break;

			case "function_declaration":
			case "method_definition":
			case "arrow_function":
				scopes.push("function");
				break;

			case "property_identifier":
				scopes.push("property");
				break;

			// check parent for more context
			default:
				if (nodeType === "identifier") {
					const parent = cursor.currentNode.parent;
					if (parent) {
						if (
							parent.type === "function_declaration" ||
							parent.type === "method_definition"
						) {
							scopes.push("function");
						} else if (
							parent.type === "class_declaration" ||
							parent.type === "interface_declaration"
						) {
							scopes.push("type");
						} else if (parent.type === "call_expression") {
							scopes.push("function-call");
						}
					}
				}
		}

		return scopes;
	}

	private getLineStartIndex(content: string, lineNumber: number): number {
		let index = 0;
		for (let i = 0; i < lineNumber; i++) {
			const newlineIndex = content.indexOf("\n", index);
			if (newlineIndex === -1) break;
			index = newlineIndex + 1;
		}
		return index;
	}

	private getLineEndIndex(content: string, lineNumber: number): number {
		const startIndex = this.getLineStartIndex(content, lineNumber);
		const newlineIndex = content.indexOf("\n", startIndex);
		return newlineIndex === -1 ? content.length : newlineIndex;
	}

	dispose() {
		if (this.tree) {
			this.tree.delete();
			this.tree = null;
		}
		if (this.parser) {
			this.parser.delete();
			this.parser = null;
		}
		this.tsLanguage = null;
		this.tsxLanguage = null;
		this.isInitialized = false;
	}
}
