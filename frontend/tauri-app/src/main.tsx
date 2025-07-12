import ReactDOM from "react-dom/client";
import App from "./App";
import { StoreProvider } from "./state";
import { startMemoryTracking } from "./utils/MemoryTracker";
import "./index.css";

// Start memory tracking for development and debugging
if (process.env.NODE_ENV === 'development' || process.env.TAURI_DEBUG) {
	console.log('[MemoryTrack] Starting memory tracking in development mode');
	startMemoryTracking();
} else {
	console.log('[MemoryTrack] Memory tracking disabled in production mode');
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<StoreProvider>
		<App />
	</StoreProvider>,
);
