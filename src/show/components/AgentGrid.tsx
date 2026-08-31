import type { Agent } from '../api/types';
import { AgentCard } from './AgentCard';

export function AgentGrid({ agents }: { agents: Agent[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {agents.map((a) => (
        <AgentCard key={a.id} agent={a} />
      ))}
    </div>
  );
}
