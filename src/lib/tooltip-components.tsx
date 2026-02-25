import React from "react";
import { cn } from "./utils";
import { useTooltipConfigStore } from "@/store/tooltip-config-store";

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
      <div
        className="font-semibold text-blue-600 tracking-tight"
        style={{ fontSize: "1.1em" }}
      >
        {title}
      </div>
      {subtitle && (
        <div
          className="text-gray-500 mt-0.5"
          style={{ fontSize: "0.9em" }}
        >
          {subtitle}
        </div>
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
  const { tooltipHeadingColor, tooltipValueColor } = useTooltipConfigStore();
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-1 py-1",
        className
      )}
      style={{ fontSize: "inherit", fontFamily: "inherit" }}
    >
      <span
        className="font-medium leading-tight"
        style={{ color: tooltipHeadingColor }}
      >
        {label}:
      </span>
      <span
        className="leading-snug wrap-break-word whitespace-pre-wrap"
        style={{
          fontFamily: "inherit",
          fontSize: "inherit",
          color: tooltipValueColor,
        }}
      >
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
      <div className={cn("flex gap-2 overflow-hidden", className)}>
        <div className="flex-1 space-y-0.5 pr-2 border-r border-gray-200 overflow-hidden">
          {properties.slice(0, midPoint).map((prop, idx) => (
            <TooltipProperty key={idx} label={prop.label} value={prop.value} />
          ))}
        </div>
        <div className="flex-1 space-y-0.5 pl-2 overflow-hidden">
          {properties.slice(midPoint).map((prop, idx) => (
            <TooltipProperty key={idx} label={prop.label} value={prop.value} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1 overflow-hidden", className)}>
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
  const { tooltipFontFamily, tooltipFontSize } = useTooltipConfigStore();
  return (
    <div
      className={cn(
        "bg-white text-gray-900 border border-gray-200 rounded-lg shadow-xl p-2 overflow-hidden min-w-[180px]",
        maxWidth,
        className
      )}
      style={{
        fontFamily: tooltipFontFamily,
        fontSize: `${tooltipFontSize}px`,
        ...style,
      }}
    >
      {children}
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
