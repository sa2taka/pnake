import { Shell } from "./ui/layout/Shell";
import { AppProvider } from "./ui/state/AppContext";
import type { ParserService } from "./ui/services/parser-service";

interface AppProps {
  parserService?: ParserService;
}

export function App({ parserService }: AppProps = {}): JSX.Element {
  return (
    <AppProvider parserService={parserService}>
      <Shell />
    </AppProvider>
  );
}
