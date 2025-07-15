import { OsSession } from "../bindings/os";
import type { TerminalSpec } from "../services/CustomTerminalAPI";
import { CanvasElement, type ElementTargets } from "./types";

export class CustomTerminal {
	private _osSession: OsSession
	public isHorizontal: boolean = false

	constructor(osSession: OsSession, isHorizontal: boolean = false) {
		this._osSession = osSession;
		this.isHorizontal = isHorizontal;
	}

	get osSession() {
		return this._osSession
	}

	targets(): ElementTargets {
		// Change aspect ratio based on orientation
		const aspectRatio = this.isHorizontal ? 21 / 9 : 16 / 9;
		return {
			size: "large",
			aspectRatio: aspectRatio,
			area: "center",
		};
	}

	static canvasElement(osSession: OsSession, weight: number = 1): CanvasElement {
		const terminal = new CustomTerminal(osSession);
		return new CanvasElement({ customTerminal: terminal }, weight);
	}
}
