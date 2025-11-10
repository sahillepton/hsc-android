const ZoomControls = ({ mapRef }: { mapRef: React.RefObject<any> }) => {
  return (
    <div className="absolute bottom-4 right-4 z-50 flex items-end gap-3">
      {/* Watermark to the left of zoom controls */}
      <div
        className="text-[10px] md:text-xs px-2 py-1 rounded font-bold"
        style={{
          background: "rgba(0,0,0,0.4)",
          color: "#ffffff",
          letterSpacing: "0.08em",
          userSelect: "none",
          pointerEvents: "none",
        }}
      >
        IGRS WGS84
      </div>

      {/* Zoom Controls */}
      <div className="flex flex-col gap-2">
        <button
          onClick={() => {
            if (mapRef.current) {
              const map = mapRef.current.getMap();
              const currentZoom = map.getZoom();
              map.easeTo({ zoom: currentZoom + 1, duration: 300 });
            }
          }}
          className="w-10 h-10 bg-white border border-gray-300 rounded-lg shadow-lg hover:bg-gray-50 transition-colors flex items-center justify-center text-gray-700 hover:text-gray-900"
          title="Zoom In"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.35-4.35"></path>
            <line x1="11" y1="8" x2="11" y2="14"></line>
            <line x1="8" y1="11" x2="14" y2="11"></line>
          </svg>
        </button>

        <button
          onClick={() => {
            if (mapRef.current) {
              const map = mapRef.current.getMap();
              const currentZoom = map.getZoom();
              map.easeTo({ zoom: currentZoom - 1, duration: 300 });
            }
          }}
          className="w-10 h-10 bg-white border border-gray-300 rounded-lg shadow-lg hover:bg-gray-50 transition-colors flex items-center justify-center text-gray-700 hover:text-gray-900"
          title="Zoom Out"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.35-4.35"></path>
            <line x1="8" y1="11" x2="14" y2="11"></line>
          </svg>
        </button>
      </div>
    </div>
  );
};

export default ZoomControls;
