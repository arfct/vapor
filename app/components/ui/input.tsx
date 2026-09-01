import * as React from "react";
import { cn } from "~/lib/cn";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.ComponentPropsWithoutRef<"input">
>(({ className, ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-md border border-border bg-paper px-3 py-2 text-sm text-ink transition-colors",
        "placeholder:text-muted",
        "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});

Input.displayName = "Input";
