import ReactDOM from "react-dom/client";
import App from "./App";
import { StoreProvider } from "./state";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<StoreProvider>
		<App />
	</StoreProvider>,
);
