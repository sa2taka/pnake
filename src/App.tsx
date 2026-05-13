import { Shell } from "./ui/layout/Shell";
import { AppProvider } from "./ui/state/AppContext";
import type { FC } from "react";
import type { ParserService } from "./ui/services/parser-service";

type AppProps = {
  parserService?: ParserService;
};

export const App: FC<AppProps> = ({ parserService }) => (
  <AppProvider parserService={parserService}>
    <Shell />
  </AppProvider>
);
