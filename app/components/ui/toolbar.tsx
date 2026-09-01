import * as React from "react";
import { cn } from "~/lib/cn";

export const Toolbar = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("relative flex items-center", className)} {...props} />
));
Toolbar.displayName = "Toolbar";

export const ToolbarGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex items-center gap-0.5", className)} {...props} />
));
ToolbarGroup.displayName = "ToolbarGroup";

export const ToolbarSeparator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("h-4 w-px bg-border", className)} {...props} />
));
ToolbarSeparator.displayName = "ToolbarSeparator";
