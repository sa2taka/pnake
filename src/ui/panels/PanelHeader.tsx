import "./PanelHeader.css";

interface PanelHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function PanelHeader({ title, subtitle, actions }: PanelHeaderProps): JSX.Element {
  return (
    <header className="panel-header">
      <span className="panel-header-title">{title}</span>
      {subtitle && <span className="panel-header-subtitle">{subtitle}</span>}
      <span className="panel-header-spacer" />
      {actions}
    </header>
  );
}
