import { CheckIcon } from "@radix-ui/react-icons";
import { cn } from "@/util/utils";

type Props = {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  selected?: boolean;
  onClick: () => void;
  disabled?: boolean;
};

function ExampleCasePill({
  icon,
  label,
  hint,
  selected = false,
  onClick,
  disabled = false,
}: Props) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-h-16 w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50",
        selected
          ? "border-brand/50 bg-brand-soft"
          : "border-border/70 bg-card/60 hover:bg-card",
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-muted text-muted-foreground [&_svg]:size-[18px]"
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium leading-5">{label}</span>
        {hint ? (
          <span className="truncate text-xs text-muted-foreground">{hint}</span>
        ) : null}
      </span>
      {selected ? (
        <CheckIcon aria-hidden="true" className="size-4 shrink-0 text-brand" />
      ) : null}
    </button>
  );
}

export { ExampleCasePill };
