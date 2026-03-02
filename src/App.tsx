import { PredictionDashboard } from "./components/PredictionDashboard";
import "./index.css";

export function App() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto flex items-center gap-3 px-6 py-4">
          <img src="./prediction.png" alt="" className="size-7" />
          <h1 className="text-lg font-semibold">Kvartpall Bestillingsforslag</h1>
        </div>
      </header>
      <main className="container mx-auto px-6 py-8">
        <PredictionDashboard />
      </main>
    </div>
  );
}

export default App;
