export type OsSessionKind = "Local" | { Wsl: string }; // WSL distribution name

export interface WslSession {
	distribution: string;
	working_directory: string; // snake_case to match Rust
}

export type OsSession =
	| { Local: string } // working directory
	| { Wsl: WslSession };

// Type guards for runtime type checking
export function isLocalSession(
	session: OsSession,
): session is { Local: string } {
	return "Local" in session;
}

export function isWslSession(
	session: OsSession,
): session is { Wsl: WslSession } {
	return "Wsl" in session;
}

export function isLocalSessionKind(kind: OsSessionKind): kind is "Local" {
	return kind === "Local";
}

export function isWslSessionKind(kind: OsSessionKind): kind is { Wsl: string } {
	return typeof kind === "object" && "Wsl" in kind;
}

export function osSessionToString(session: OsSession): string {
	if (isLocalSession(session)) {
		return `Local: ${session.Local}`;
	} else if (isWslSession(session)) {
		return `WSL: ${session.Wsl.distribution} (${session.Wsl.working_directory})`;
	}
	return "Unknown OS Session";
}

export function osSessionEquals(sessionA: OsSession, sessionB: OsSession): boolean {
	return osSessionToString(sessionA) == osSessionToString(sessionB)
}

export function osSessionGetWorkingDirectory(session: OsSession) {
		if (isLocalSession(session)) {
		return session.Local;
	} else if (isWslSession(session)) {
		return session.Wsl.working_directory;
	}
}