import * as React from "react";
import { cn } from "~/lib/cn";

interface ButtonProps extends React.ComponentPropsWithoutRef<"button"> {
  variant?: "default" | "ghost" | "destructive";
  size?: "default" | "sm" | "icon";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", type = "button", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex cursor-pointer items-center justify-center font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
          "disabled:pointer-events-none disabled:opacity-50",
          "rounded-full",
          {
            "bg-primary text-paper hover:bg-primary/90": variant === "default",
            "hover:bg-accent hover:text-ink": variant === "ghost",
            "bg-destructive text-white hover:bg-destructive/90": variant === "destructive",
            "h-10 px-4 py-2": size === "default",
            "h-9 px-3 text-sm": size === "sm",
            "h-10 w-10 p-0": size === "icon",
          },
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
