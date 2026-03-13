import type { Metadata } from "next";
import "./globals.css";
import { InterviewProvider } from "@/context/InterviewContext";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "EchoHire - AI Mock Interview",
  description: "Real-Time AI Mock Interview Web Application",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&family=Space+Grotesk:wght@500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body antialiased bg-background">
        <InterviewProvider>
          {children}
          <Toaster />
        </InterviewProvider>
      </body>
    </html>
  );
}
