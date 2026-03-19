import { useEffect, useState } from "react";

const API_BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:8787/api/chat").replace(/\/api\/chat$/, "");

interface Skill {
  id: string;
  name: string;
  description: string;
  source: "global" | "local";
  preview: string;
}

export function SkillsPanel({ onClose }: { onClose: () => void }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/skills`)
      .then(r => r.json())
      .then(data => setSkills(data))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <div className="panel-backdrop" onClick={onClose} />
      <aside className="skills-panel">
        <div className="skills-panel-header">
          <span className="skills-panel-title">Skills Library</span>
          <span className="skills-panel-count">{loading ? "…" : skills.length}</span>
        </div>

        <div className="skills-list">
          {loading ? (
            <div className="skills-empty">Loading…</div>
          ) : skills.length === 0 ? (
            <div className="skills-empty">No skills found</div>
          ) : (
            skills.map((skill, i) => (
              <div
                key={skill.id}
                className="skill-card"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <div className="skill-card-header">
                  <span className="skill-name">{skill.name}</span>
                  <span className={`skill-badge ${skill.source}`}>{skill.source}</span>
                </div>
                {skill.description && (
                  <p className="skill-description">{skill.description}</p>
                )}
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
