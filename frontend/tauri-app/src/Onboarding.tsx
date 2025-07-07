import { useContext, useEffect, useState } from "react";
import { InterpreterContext } from "./App";
import { useStore } from "./state";
import { cn } from "./utils";

const Onboarding = ({ userEmail }: { userEmail: string }) => {
	const { showOnboarding } = useStore();
	const interpreter = useContext(InterpreterContext);

	if (!showOnboarding) {
		return null;
	}

	return (
		<div
			id="onboarding"
			className={cn(
				"group relative text-center p-8 border-(length:--border) border-[var(--base-100)]/0 hover:border-[var(--base-100)]/20 border-dashed",
			)}
		>
			<button
				className={cn(
					"group/closebutton absolute right-0 top-0 group-hover:flex hidden p-1 items-center justify-center cursor-pointer border-b-[var(--border)] border-t-[var(--border)] border-[var(--base-100)]/20 border-dashed rounded-bl-md",
				)}
				onClick={async () => {
					await interpreter?.tryRunInstruction("Onboarding.hide()");
				}}
			>
				<div
					className={cn(
						"group-hover/closebutton:opacity-100 opacity-50 text-xl",
					)}
				>
					✕
				</div>
			</button>
			<div className={cn("flex flex-col items-center gap-0.5")}>
				<img src="./assets/app-icon.png" className={cn("w-56 opacity-10")} />
				<h1 className={cn("text-5xl font-mono font-black mb-8")}>Ariana IDE</h1>
			</div>
			<p className={cn("text-[var(--base-100)] text-lg px-2")}>
				Welcome, {userEmail}
			</p>
		</div>
	);
};

export default Onboarding;
