import type { FC, ReactNode } from "react";
import "./PanelHeader.css";

type PanelHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
};

export const PanelHeader: FC<PanelHeaderProps> = ({ title, subtitle, actions }) => (
  <header className="panel-header">
    <span className="panel-header-title">{title}</span>
    {subtitle && <span className="panel-header-subtitle">{subtitle}</span>}
    <span className="panel-header-spacer" />
    {actions}
  </header>
);
