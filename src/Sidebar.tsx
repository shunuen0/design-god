import { Clock3, Images, Layers, Moon, Plus, Sun } from "lucide-react";
import godLogo from "./o.png";

type ActivePanel = "gallery" | "skills" | "history" | null;
type Theme = "light" | "dark";

interface SidebarProps {
  activePanel: ActivePanel;
  theme: Theme;
  onNewChat: () => void;
  onToggleHistory: () => void;
  onToggleGallery: () => void;
  onToggleSkills: () => void;
  onToggleTheme: () => void;
}

export function Sidebar({ activePanel, theme, onNewChat, onToggleHistory, onToggleGallery, onToggleSkills, onToggleTheme }: SidebarProps) {
  return (
    <nav className="sidebar">
      <div className="sidebar-top">
        <button className="sidebar-logo-btn" onClick={onNewChat} aria-label="New chat">
          <img src={godLogo} alt="Design God" className="sidebar-logo" />
        </button>
      </div>

      <div className="sidebar-actions">
        <SidebarButton icon={<Plus size={18} strokeWidth={1.75} />} label="New chat" onClick={onNewChat} />
        <SidebarButton icon={<Clock3 size={18} strokeWidth={1.75} />} label="History" active={activePanel === "history"} onClick={onToggleHistory} />
        <SidebarButton icon={<Images size={18} strokeWidth={1.75} />} label="Gallery" active={activePanel === "gallery"} onClick={onToggleGallery} />
        <SidebarButton icon={<Layers size={18} strokeWidth={1.75} />} label="Skills" active={activePanel === "skills"} onClick={onToggleSkills} />
      </div>

      <div className="sidebar-footer">
        <SidebarButton
          icon={theme === "dark" ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
          label={theme === "dark" ? "Light mode" : "Dark mode"}
          onClick={onToggleTheme}
        />
      </div>
    </nav>
  );
}

function SidebarButton({ icon, label, active = false, onClick }: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="sidebar-btn-wrap">
      <button className={`sidebar-btn${active ? " active" : ""}`} onClick={onClick} aria-label={label} aria-pressed={active}>
        {icon}
      </button>
      <span className="sidebar-tooltip" role="tooltip">{label}</span>
    </div>
  );
}
