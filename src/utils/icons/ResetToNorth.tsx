const ResetToNorth = ({
  width = 24,
  height = 24,
  strokeWidth = 2,
  color = "currentColor",
  style = {},
}: {
  width?: number;
  height?: number;
  strokeWidth?: number;
  color?: string;
  style?: React.CSSProperties;
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={width}
      height={height}
      fill="none"
      stroke={color}
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      style={style}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 5l3 7-3-2-3 2 3-7Z" fill={color} stroke="none" />
      <path d="M10 17v-4l4 4v-4" />
    </svg>
  );
};

export default ResetToNorth;
