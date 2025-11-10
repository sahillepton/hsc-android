const IconSelection = ({
  selectedNodeForIcon,
  setSelectedNodeForIcon,
  getAvailableIcons,
  setNodeIcon,
  nodeIconMappings,
}: {
  selectedNodeForIcon: string;
  setSelectedNodeForIcon: (nodeForIcon: string | null) => void;
  getAvailableIcons: () => string[];
  setNodeIcon: (nodeForIcon: string, iconName: string) => void;
  nodeIconMappings: Record<string, string>;
}) => {
  return (
    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3 max-w-xs">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-800">
          Node {selectedNodeForIcon}
        </h3>
        <button
          onClick={() => setSelectedNodeForIcon(null)}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-5 gap-1 mb-2">
        {getAvailableIcons().map((iconName) => (
          <button
            key={iconName}
            onClick={() => {
              setNodeIcon(selectedNodeForIcon, iconName);
              setSelectedNodeForIcon(null);
            }}
            className={`flex flex-col items-center p-1.5 rounded border transition-all ${
              nodeIconMappings[selectedNodeForIcon] === iconName
                ? "border-blue-500 bg-blue-50"
                : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
            }`}
            title={iconName.replace(/_/g, " ").replace(/-/g, " ")}
          >
            <img
              src={`/icons/${iconName}.svg`}
              alt={iconName}
              className="w-4 h-4"
            />
          </button>
        ))}
      </div>

      <button
        onClick={() => {
          setNodeIcon(selectedNodeForIcon, "");
          setSelectedNodeForIcon(null);
        }}
        className="w-full px-2 py-1 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors"
      >
        Default
      </button>
    </div>
  );
};

export default IconSelection;
