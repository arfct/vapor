import { useState, useEffect } from "react";
import { useTheme, type Theme } from "~/lib/useTheme";
import { Menu, MenuTrigger, MenuContent, MenuItem } from "~/components/ui/menu";
import Icon from "~/components/Icon";

const options: { value: Theme; icon: string; label: string }[] = [
  { value: "light", icon: "light_mode", label: "Light" },
  { value: "dark", icon: "dark_mode", label: "Dark" },
  { value: "auto", icon: "computer", label: "Auto" },
];

function ChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const current = options.find((o) => o.value === theme) ?? options[2];

  // Render a static placeholder during SSR to avoid portal/id hydration mismatch
  if (!mounted) {
    return (
      <button
        className="flex cursor-pointer items-center gap-0.5 px-3 text-muted transition-colors hover:text-ink"
        aria-label="Theme"
      >
        <Icon name="computer" />
        <ChevronDown />
      </button>
    );
  }

  return (
    <Menu>
      <MenuTrigger>
        <button
          className="flex cursor-pointer items-center gap-0.5 px-3 text-muted transition-colors hover:text-ink"
          aria-label="Theme"
        >
          <Icon name={current.icon} />
          <ChevronDown />
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        {options.map((o) => (
          <MenuItem key={o.value} className="gap-2" onClick={() => setTheme(o.value)}>
            <Icon name={o.icon} />
            <span>{o.label}</span>
            {theme === o.value && <span className="ml-auto pl-3 text-muted">{"✓"}</span>}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
