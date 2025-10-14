import React, { useState } from "react";
import { useLayersContext } from "@/layers-provider";

interface IconSelectorProps {
  nodeId: string;
  currentIcon?: string;
  onIconChange?: (iconName: string) => void;
}

export const IconSelector: React.FC<IconSelectorProps> = ({
  nodeId,
  currentIcon,
  onIconChange,
}) => {
  const { getAvailableIcons, setNodeIcon } = useLayersContext();
  const [isOpen, setIsOpen] = useState(false);
  const availableIcons = getAvailableIcons();

  const handleIconSelect = (iconName: string) => {
    setNodeIcon(nodeId, iconName);
    onIconChange?.(iconName);
    setIsOpen(false);
  };

  const getIconDisplayName = (iconName: string) => {
    return iconName
      .replace(/_/g, " ")
      .replace(/-/g, " ")
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm transition-colors"
      >
        {currentIcon && (
          <img
            src={`/icons/${currentIcon}.svg`}
            alt={currentIcon}
            className="w-4 h-4"
          />
        )}
        <span className="text-gray-700">
          {currentIcon ? getIconDisplayName(currentIcon) : "Select Icon"}
        </span>
        <svg
          className={`w-4 h-4 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
          <div className="p-2">
            <div className="text-xs text-gray-500 mb-2 px-2">
              Available Icons:
            </div>
            <div className="grid grid-cols-2 gap-1">
              {availableIcons.map((iconName) => (
                <button
                  key={iconName}
                  onClick={() => handleIconSelect(iconName)}
                  className={`flex items-center gap-2 px-2 py-1 rounded text-xs transition-colors ${
                    currentIcon === iconName
                      ? "bg-blue-100 text-blue-700"
                      : "hover:bg-gray-100 text-gray-700"
                  }`}
                >
                  <img
                    src={`/icons/${iconName}.svg`}
                    alt={iconName}
                    className="w-4 h-4"
                  />
                  <span className="truncate">
                    {getIconDisplayName(iconName)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default IconSelector;
