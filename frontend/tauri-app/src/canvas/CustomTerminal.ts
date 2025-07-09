import { OsSession } from "../bindings/os";
import type { TerminalSpec } from "../services/CustomTerminalAPI";
import { CanvasElement, type ElementTargets } from "./types";

export class CustomTerminal {
	private _osSession: OsSession

	constructor(osSession: OsSession) {
		this._osSession = osSession;
	}

	get osSession() {
		return this._osSession
	}

	targets(): ElementTargets {
		return {
			size: "large",
			aspectRatio: 16 / 9, // Terminal aspect ratio
			area: "center",
		};
	}

	static canvasElement(osSession: OsSession, weight: number = 1): CanvasElement {
		const terminal = new CustomTerminal(osSession);
		return new CanvasElement({ customTerminal: terminal }, weight);
	}
}
