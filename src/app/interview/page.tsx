"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useInterview } from "@/hooks/useInterview";
import { useLiveInterview } from "@/hooks/useLiveInterview";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Mic, MicOff, PhoneOff, Bot, AlertTriangle } from "lucide-react";
import { ThinkingIcon, SpeakingIcon, ListeningIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export default function InterviewPage() {
  const router = useRouter();
  const {
    jobDescription,
    resume,
    aiStatus,
    interviewStatus,
    resetInterview,
  } = useInterview();

  const { startInterview, endInterview, isMuted, toggleMute } =
    useLiveInterview();

  useEffect(() => {
    if (interviewStatus === "idle") {
      startInterview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewStatus]);

  useEffect(() => {
    if (interviewStatus === "finished") {
      router.push("/report");
    }
  }, [interviewStatus, router]);

  useEffect(() => {
    if (!jobDescription || !resume) {
      router.push("/");
    }
  }, [jobDescription, resume, router]);
  
  const handleTryAgain = () => {
    resetInterview();
    router.push("/");
  };

  const StatusIndicator = () => {
    let icon, text, color;

    if (interviewStatus === 'error') {
      return (
        <div className="flex flex-col items-center justify-center gap-4 text-center p-8 bg-destructive/10 rounded-lg">
          <AlertTriangle className="h-16 w-16 text-destructive" />
          <h3 className="text-xl font-headline text-destructive-foreground">Connection Error</h3>
          <p className="text-sm text-destructive-foreground/80 max-w-sm">
            We couldn't maintain a connection to the AI interviewer. This might be due to a network issue or a problem with the service.
          </p>
          <Button onClick={handleTryAgain} variant="destructive" className="mt-4">
            Return to Setup
          </Button>
        </div>
      );
    }

    switch (aiStatus) {
      case "listening":
        icon = <ListeningIcon className="h-16 w-16 text-accent" />;
        text = "Listening...";
        color = "text-accent";
        break;
      case "speaking":
        icon = <SpeakingIcon className="h-16 w-16 text-primary" />;
        text = "Speaking...";
        color = "text-primary";
        break;
      case "thinking":
        icon = <ThinkingIcon className="h-16 w-16 text-secondary-foreground" />;
        text = "Thinking...";
        color = "text-secondary-foreground";
        break;
      default:
        icon = <Bot className="h-16 w-16 text-muted-foreground" />;
        text = "Initializing...";
        color = "text-muted-foreground";
    }

    return (
      <div className="flex flex-col items-center justify-center gap-4 text-center">
        {icon}
        <p className={cn("text-lg font-medium", color)}>{text}</p>
      </div>
    );
  };

  return (
    <div className="flex h-screen w-full flex-col items-center justify-center p-4 md:p-8">
      <Card className="w-full max-w-4xl h-full flex flex-col shadow-2xl">
        <CardContent className="flex-1 flex flex-col p-4 md:p-6 overflow-hidden">
          <div className="flex-1 grid place-items-center overflow-hidden">
            <div className="flex flex-col items-center justify-center h-full p-6 bg-muted/50 rounded-lg w-full max-w-md">
              <StatusIndicator />
            </div>
          </div>
          <div className="flex justify-center items-center gap-4 pt-6 mt-6 border-t shrink-0">
            <Button
              variant={isMuted ? "outline" : "secondary"}
              size="lg"
              className="rounded-full w-16 h-16"
              onClick={toggleMute}
              aria-label={isMuted ? "Unmute" : "Mute"}
              disabled={interviewStatus === 'error'}
            >
              {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
            </Button>
            <Button
              variant="destructive"
              size="lg"
              className="rounded-full w-16 h-16"
              onClick={endInterview}
              aria-label="End Interview"
              disabled={interviewStatus === 'error'}
            >
              <PhoneOff size={24} />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
