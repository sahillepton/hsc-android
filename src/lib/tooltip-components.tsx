import React from "react";
import { cn } from "./utils";

/**
 * Tooltip Heading Component
 * Consistent heading style for all tooltips
 */
export const TooltipHeading = ({
  title,
  subtitle,
  className,
}: {
  title: string;
  subtitle?: string;
  className?: string;
}) => {
  return (
    <div className={cn("mb-1.5 pb-1 border-b border-gray-200", className)}>
      <div className="font-semibold text-sm text-blue-600 tracking-tight truncate">
        {title}
      </div>
      {subtitle && (
        <div className="text-xs text-gray-500 mt-0.5 truncate">{subtitle}</div>
      )}
    </div>
  );
};

/**
 * Tooltip Property Row Component
 * Consistent property display for all tooltips
 */
export const TooltipProperty = ({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn("flex justify-between items-start gap-2 py-0.5", className)}
    >
      <span className="text-gray-700 font-medium text-xs min-w-[80px] shrink-0">
        {label}:
      </span>
      <span className="text-gray-900 text-xs text-right font-mono break-words flex-1 min-w-0">
        {value}
      </span>
    </div>
  );
};

/**
 * Tooltip Properties Grid Component
 * Displays properties in a consistent grid layout
 */
export const TooltipProperties = ({
  properties,
  useGridLayout = false,
  className,
}: {
  properties: Array<{ label: string; value: React.ReactNode }>;
  useGridLayout?: boolean;
  className?: string;
}) => {
  if (properties.length === 0) return null;

  if (useGridLayout && properties.length > 6) {
    const midPoint = Math.ceil(properties.length / 2);
    return (
      <div className={cn("flex gap-2", className)}>
        <div className="flex-1 space-y-0.5 pr-2 border-r border-gray-200">
          {properties.slice(0, midPoint).map((prop, idx) => (
            <TooltipProperty key={idx} label={prop.label} value={prop.value} />
          ))}
        </div>
        <div className="flex-1 space-y-0.5 pl-2">
          {properties.slice(midPoint).map((prop, idx) => (
            <TooltipProperty key={idx} label={prop.label} value={prop.value} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-0.5", className)}>
      {properties.map((prop, idx) => (
        <TooltipProperty key={idx} label={prop.label} value={prop.value} />
      ))}
    </div>
  );
};

/**
 * Tooltip Bounding Box Component
 * Consistent container/wrapper for all tooltips
 */
export const TooltipBox = ({
  children,
  maxWidth = "max-w-[200px]",
  className,
  style,
}: {
  children: React.ReactNode;
  maxWidth?: string;
  className?: string;
  style?: React.CSSProperties;
}) => {
  return (
    <div
      className={cn(
        "bg-white text-gray-900 border border-gray-200 rounded-lg shadow-xl p-2 overflow-hidden",
        maxWidth,
        className
      )}
      style={style}
    >
      <div className="w-full min-w-0">{children}</div>
    </div>
  );
};

/**
 * Tooltip Section Divider
 * For separating sections within tooltips
 */
export const TooltipDivider = ({ className }: { className?: string }) => {
  return <div className={cn("my-1 border-t border-gray-200", className)} />;
};
