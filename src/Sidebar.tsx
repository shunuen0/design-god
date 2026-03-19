import { useState } from "react";
import { Images, Layers, Plus, PanelLeftOpen } from "lucide-react";
import godLogo from "./o.png";

type ActivePanel = "gallery" | "skills" | null;

interface SidebarProps {
  activePanel: ActivePanel;
  onNewChat: () => void;
  onToggleGallery: () => void;
  onToggleSkills: () => void;
}

export function Sidebar({ activePanel, onNewChat, onToggleGallery, onToggleSkills }: SidebarProps) {
  const [expanded, setExpanded] = useState(false);
  const [logoHovered, setLogoHovered] = useState(false);

  const showExpandIcon = logoHovered && !expanded;

  return (
    <nav className={`sidebar${expanded ? " sidebar-expanded" : ""}`} aria-expanded={expanded}>
      <div className="sidebar-top">
        <button
          className="sidebar-logo-btn"
          onClick={() => setExpanded(v => !v)}
          onMouseEnter={() => setLogoHovered(true)}
          onMouseLeave={() => setLogoHovered(false)}
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          <span className="sidebar-logo-wrap">
            <img
              src={godLogo}
              alt="Design God"
              className="sidebar-logo"
              style={{
                opacity: showExpandIcon ? 0 : 1,
                filter: showExpandIcon ? "blur(3px)" : "blur(0px)",
              }}
            />
            <PanelLeftOpen
              size={18}
              strokeWidth={1.75}
              className="sidebar-expand-icon"
              style={{
                opacity: showExpandIcon ? 1 : 0,
                filter: showExpandIcon ? "blur(0px)" : "blur(3px)",
              }}
            />
          </span>
          {expanded && <span className="sidebar-brand">Design God</span>}
        </button>
      </div>

      <div className="sidebar-actions">
        <SidebarButton
          icon={<Plus size={18} strokeWidth={1.75} />}
          label="New chat"
          expanded={expanded}
          onClick={onNewChat}
        />
        <SidebarButton
          icon={<Images size={18} strokeWidth={1.75} />}
          label="Gallery"
          active={activePanel === "gallery"}
          expanded={expanded}
          onClick={onToggleGallery}
        />
        <SidebarButton
          icon={<Layers size={18} strokeWidth={1.75} />}
          label="Skills"
          active={activePanel === "skills"}
          expanded={expanded}
          onClick={onToggleSkills}
        />
      </div>
    </nav>
  );
}

function SidebarButton({
  icon,
  label,
  active = false,
  expanded,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <div className="sidebar-btn-wrap">
      <button
        className={`sidebar-btn${active ? " active" : ""}`}
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
      >
        {icon}
        <span className="sidebar-btn-label">{label}</span>
      </button>
      {!expanded && <span className="sidebar-tooltip" role="tooltip">{label}</span>}
    </div>
  );
}
