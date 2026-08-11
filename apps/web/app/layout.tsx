import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Dialogs from "../components/Dialogs";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

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
      <body className={inter.variable}>
        {children}
        <Dialogs />
      </body>
    </html>
  );
}
