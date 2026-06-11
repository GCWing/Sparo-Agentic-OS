import { publicAsset } from "@/lib/assets";

export function Logo({
  size = 30,
  withWordmark = false,
  tone = "dark",
}: {
  size?: number;
  withWordmark?: boolean;
  tone?: "dark" | "light";
}) {
  return (
    <span className="inline-flex items-center" style={{ gap: withWordmark ? 10 : 0 }}>
      <img
        src={publicAsset("logo/sparo-mark.png")}
        width={size}
        height={size}
        alt="Sparo"
        style={{ width: size, height: size, objectFit: "contain" }}
      />
      {withWordmark && (
        <span
          style={{
            fontWeight: 700,
            fontSize: size * 0.56,
            letterSpacing: "-0.01em",
            color: tone === "light" ? "#FFFFFF" : "#1A1B1E",
          }}
        >
          Sparo OS
        </span>
      )}
    </span>
  );
}

export default Logo;
