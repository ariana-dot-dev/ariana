import { OsSession, osSessionToString } from "../bindings/os";
import { CanvasElement, type ElementTargets } from "./types";

export class Terminal {
	private _osSession: OsSession;
	private _targets: ElementTargets;
	private _isConnected: boolean = false;
	private _connectionId?: string;

	constructor(osSession: OsSession) {
		this._targets = {
			size: "medium",
			aspectRatio: 1 / 10,
			area: "bottom",
		};
		this._osSession = osSession;
	}

	targets(): ElementTargets {
		return this._targets;
	}

	updateTargets(newTargets: Partial<ElementTargets>): void {
		this._targets = { ...this._targets, ...newTargets };
	}

	get isConnected(): boolean {
		return this._isConnected;
	}

	get connectionId(): string | undefined {
		return this._connectionId;
	}

	get osSession(): OsSession {
		return this._osSession;
	}

	setConnection(connectionId: string, connected: boolean): void {
		this._connectionId = connectionId;
		this._isConnected = connected;
	}

	getConnectionString(): string {
		return osSessionToString(this._osSession);
	}

	static canvasElement(
		osSession: OsSession,
		weight: number = 1,
	): CanvasElement {
		return new CanvasElement({ terminal: new Terminal(osSession) }, weight);
	}

	// Helper methods for creating different terminal types
	static createLocalShell(
		workingDirectory?: string,
		weight: number = 1,
	): CanvasElement {
		const osSession: OsSession = {
			Local: workingDirectory || "~",
		};
		return Terminal.canvasElement(osSession, weight);
	}
}
