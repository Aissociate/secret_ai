import type { ReactNode } from 'react';
import type { Agent } from '../api/types';

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlightAgentNames(
  text: string,
  agentMap?: Map<string, Agent>
): ReactNode {
  if (!agentMap || agentMap.size === 0) return text;

  const names = Array.from(agentMap.values())
    .map((a) => a.name)
    .filter((n) => n.length >= 2)
    .sort((a, b) => b.length - a.length);

  if (names.length === 0) return text;

  const pattern = new RegExp(`(${names.map(escapeRegex).join('|')})`, 'gi');
  const parts = text.split(pattern);

  if (parts.length === 1) return text;

  const nameSet = new Set(names.map((n) => n.toLowerCase()));

  return parts.map((part, i) => {
    if (nameSet.has(part.toLowerCase())) {
      return (
        <strong key={i} className="font-bold text-sky-300">
          {part}
        </strong>
      );
    }
    return part;
  });
}
