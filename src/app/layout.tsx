import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { GenerationToastProvider } from "@/components/ui/GenerationToast";
import { ToastProvider } from "@/components/ui/Toast";

export const metadata: Metadata = {
  title: "HOMI",
  description: "HOMI — AI 영상 제작 협업 플랫폼",
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
