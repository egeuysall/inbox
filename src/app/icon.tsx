import { ImageResponse } from "next/og";

export const size = {
  width: 512,
  height: 512,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "86%",
            height: "86%",
            borderRadius: "999px",
            background: "#000000",
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 220,
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          &gt;
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
