import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vision Labeler",
  description:
    "Upload images or videos, extract frames, and label them with bounding boxes.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
