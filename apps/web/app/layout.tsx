import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenShift AI vs AWS TCO Calculator",
  description: "Compare OpenShift AI on ROSA, ARO, and OSD with AWS Bedrock and EC2 GPU hosting",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
