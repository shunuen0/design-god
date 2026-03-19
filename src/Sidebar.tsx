import { Images, Layers, Plus } from "lucide-react";
import godLogo from "./o.png";

type ActivePanel = "gallery" | "skills" | null;

interface SidebarProps {
  activePanel: ActivePanel;
  onNewChat: () => void;
  onToggleGallery: () => void;
  onToggleSkills: () => void;
}

export function Sidebar({ activePanel, onNewChat, onToggleGallery, onToggleSkills }: SidebarProps) {
  return (
    <nav className="sidebar">
      <div className="sidebar-top">
        <button className="sidebar-logo-btn" onClick={onNewChat} aria-label="New chat">
          <img src={godLogo} alt="Design God" className="sidebar-logo" />
        </button>
      </div>

      <div className="sidebar-actions">
        <SidebarButton icon={<Plus size={18} strokeWidth={1.75} />} label="New chat" onClick={onNewChat} />
        <SidebarButton icon={<Images size={18} strokeWidth={1.75} />} label="Gallery" active={activePanel === "gallery"} onClick={onToggleGallery} />
        <SidebarButton icon={<Layers size={18} strokeWidth={1.75} />} label="Skills" active={activePanel === "skills"} onClick={onToggleSkills} />
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
