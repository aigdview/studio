"use client";

import { useInterview } from "@/hooks/useInterview";
import { useLiveInterview } from "@/hooks/useLiveInterview";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Phone, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SpeakingIcon, ListeningIcon, ThinkingIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export default function InterviewPage() {
  const router = useRouter();
  const {
    interviewStatus,
    aiStatus,
    resetInterview,
  } = useInterview();
  const { startInterview, endInterview, isMuted, toggleMute } =
    useLiveInterview();

  useEffect(() => {
    if (interviewStatus === "idle") {
      startInterview();
    } else if (interviewStatus === "finished") {
      router.push("/report");
    }
  }, [interviewStatus, router, startInterview]);

  const handleEndCall = () => {
    endInterview();
  };
  
  const handleTryAgain = () => {
    resetInterview();
    router.push("/");
  };

  const getAiStatusDisplay = () => {
    switch (aiStatus) {
      case "listening":
        return {
          icon: <ListeningIcon className="w-16 h-16 text-blue-400" />,
          text: "Listening...",
        };
      case "speaking":
        return {
          icon: <SpeakingIcon className="w-16 h-16 text-green-400" />,
          text: "AI is speaking...",
        };
      case "thinking":
        return {
          icon: <ThinkingIcon className="w-16 h-16 text-yellow-400" />,
          text: "Thinking...",
        };
      case "idle":
      default:
        return {
          icon: <Loader2 className="w-16 h-16 animate-spin text-primary" />,
          text: "Initializing...",
        };
    }
  };

  if (interviewStatus === "idle" || (interviewStatus === "in-progress" && aiStatus === "idle")) {
     return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-background">
        <Loader2 className="w-16 h-16 animate-spin text-primary" />
        <p className="mt-4 text-muted-foreground">Initializing interview...</p>
      </main>
    );
  }

  if (interviewStatus === "error") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
        <Card className="max-w-md text-center">
            <CardHeader>
                <CardTitle>Connection Failed</CardTitle>
            </CardHeader>
            <CardContent>
                <p className="mb-6 text-muted-foreground">We couldn't establish a connection to the interview service. This might be due to a network issue or an invalid API key.</p>
                <Button onClick={handleTryAgain}>Try Again</Button>
            </CardContent>
        </Card>
      </main>
    )
  }

  const { icon, text } = getAiStatusDisplay();

  return (
    <main className="flex h-screen flex-col items-center justify-center bg-gray-900 text-white p-4">
      <div className="flex flex-col items-center justify-center flex-grow">
        <div className="w-48 h-48 rounded-full flex items-center justify-center bg-gray-800/50 relative mb-8">
            <div className={cn("absolute inset-0 rounded-full bg-blue-400/20 blur-2xl", {
                "animate-pulse": aiStatus === "listening",
            })}></div>
            {icon}
        </div>
        <p className="text-lg text-gray-400">{text}</p>
      </div>

      <div className="flex w-full max-w-xs justify-around items-center p-4 rounded-full bg-gray-800/70 backdrop-blur-sm">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleMute}
          className="rounded-full w-16 h-16 bg-white/10 hover:bg-white/20"
        >
          {isMuted ? (
            <MicOff className="h-7 w-7" />
          ) : (
            <Mic className="h-7 w-7" />
          )}
        </Button>
        <Button
          variant="destructive"
          size="icon"
          onClick={handleEndCall}
          className="rounded-full w-20 h-20"
        >
          <Phone className="h-8 w-8" />
        </Button>
        <div className="w-16 h-16"></div>
      </div>
    </main>
  );
}
