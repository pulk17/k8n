import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import Dialogs from "../components/Dialogs";

export const metadata: Metadata = {
  title: "k8n - Visual Kubernetes IDE",
  description: "Visual IDE for Kubernetes - Build, manage, and deploy K8s resources with an intuitive graph interface",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Dialogs />
      </body>
    </html>
  );
}
