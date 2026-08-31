interface Tab {
  key: string;
  label: string;
}

interface TabsProps {
  tabs: Tab[];
  value: string;
  onChange: (key: string) => void;
}

export function Tabs({ tabs, value, onChange }: TabsProps) {
  return (
    <div className="flex gap-2 flex-wrap">
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={`
              px-3.5 py-2 rounded-full text-xs font-medium border transition-all duration-200
              ${
                active
                  ? 'bg-white/12 border-white/20 text-white'
                  : 'bg-white/4 border-white/8 text-white/60 hover:bg-white/8 hover:text-white/80'
              }
            `}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
