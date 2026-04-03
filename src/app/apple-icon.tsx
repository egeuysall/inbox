import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f9f9f9",
          color: "#0a0a0a",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 90,
          fontWeight: 700,
        }}
      >
        &gt;
      </div>
    ),
    {
      ...size,
    },
  );
}
