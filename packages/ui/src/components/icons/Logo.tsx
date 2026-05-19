export const Logo = ({
	className,
	showVersion,
	showBeta,
	white,
	hideLogoName,
	viewBoxDimensions = "0 0 280 100",
	style,
}: {
	className?: string;
	showVersion?: boolean;
	showBeta?: boolean;
	white?: boolean;
	hideLogoName?: boolean;
	style?: React.CSSProperties;
	viewBoxDimensions?: `${string} ${string} ${string} ${string}`;
}) => {
	return (
		<div className="flex items-center">
			<svg
				viewBox={hideLogoName ? "0 0 100 100" : "0 0 280 100"}
				xmlns="http://www.w3.org/2000/svg"
				preserveAspectRatio="xMidYMid meet"
				fill="none"
				style={style}
				role="img"
				aria-label="Looms Logo"
				className={className}
			>
				<title>Looms</title>
				<rect width="100" height="100" rx="22" fill="#2D6FF7" />
				<g fill="#ffffff">
					<rect x="28" y="22" width="11" height="56" rx="2" />
					<rect x="28" y="67" width="33" height="11" rx="2" />
					<path d="M55 38 L72 50 L55 62 Z" />
				</g>
				{!hideLogoName && (
					<text
						x="118"
						y="68"
						fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
						fontWeight="700"
						fontSize="54"
						letterSpacing="-1.5"
						fill={white ? "#ffffff" : "#12161F"}
					>
						Looms
					</text>
				)}
			</svg>
			{showVersion && (
				<span
					className={`text-[10px] font-medium ${
						white ? "text-white" : "text-gray-1"
					}`}
				>
					v{process.env.appVersion}
				</span>
			)}
			{showBeta && (
				<span
					className={`text-[10px] font-medium min-w-[52px] ${
						white ? "text-white" : "text-gray-1"
					}`}
				>
					Beta v{process.env.appVersion}
				</span>
			)}
		</div>
	);
};
