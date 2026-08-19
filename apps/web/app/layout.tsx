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
  // k8n is dark by design — the canvas, the nodes and the toolbar are all dark
  // whatever the OS says. Declaring it here is what makes every `dark:` class
  // in the app agree with them, instead of following the OS preference.
  return (
    <html lang="en" className="dark">
      <body>
        {children}
        <Dialogs />
      </body>
    </html>
  );
}
