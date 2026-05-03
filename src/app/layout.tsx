import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { GenerationToastProvider } from "@/components/ui/GenerationToast";
import { ToastProvider } from "@/components/ui/Toast";

export const metadata: Metadata = {
  title: "AI 영상 협업툴",
  description: "멀티유저 AI 영상 제작 워크플로우 플랫폼",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="h-full" suppressHydrationWarning>
      <body className="h-full">
        <ThemeProvider>
          {children}
          <GenerationToastProvider />
          <ToastProvider />
        </ThemeProvider>
      </body>
    </html>
  );
}
