"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useInterview } from "@/hooks/useInterview";
import { useLiveInterview } from "@/hooks/useLiveInterview";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Mic, MicOff, PhoneOff, Bot as BotIcon } from "lucide-react";
import { ThinkingIcon, SpeakingIcon, ListeningIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export default function InterviewPage() {
  const router = useRouter();
  const {
    jobDescription,
    resume,
    aiStatus,
    interviewStatus,
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
    if (interviewStatus === 'finished') {
      router.push("/report");
    }
  }, [interviewStatus, router]);

  useEffect(() => {
    if (!jobDescription || !resume) {
      router.push("/");
    }
  }, [jobDescription, resume, router]);

  const StatusIndicator = () => {
    let icon, text, color;

    switch (aiStatus) {
      case "listening":
        icon = <ListeningIcon className="h-24 w-24 text-accent" />;
        text = "Listening...";
        color = "text-accent";
        break;
      case "speaking":
        icon = <SpeakingIcon className="h-24 w-24 text-primary" />;
        text = "Speaking...";
        color = "text-primary";
        break;
      case "thinking":
        icon = <ThinkingIcon className="h-24 w-24 text-secondary-foreground" />;
        text = "Thinking...";
        color = "text-secondary-foreground";
        break;
      default:
        icon = <BotIcon className="h-24 w-24 text-muted-foreground" />;
        text = "Initializing...";
        color = "text-muted-foreground";
    }

    return (
      <div className="flex flex-col items-center justify-center gap-6 text-center">
        {icon}
        <p className={cn("text-2xl font-medium", color)}>{text}</p>
      </div>
    );
  };

  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-background p-4 sm:p-8">
      <Card className="w-full max-w-2xl h-[70vh] flex flex-col shadow-2xl">
        <CardContent className="flex-1 flex flex-col items-center justify-center p-6 relative">
          <div className="flex-1 flex items-center justify-center">
            <StatusIndicator />
          </div>
          <div className="absolute bottom-8 flex justify-center items-center gap-6">
            <Button
              variant={isMuted ? "outline" : "secondary"}
              size="lg"
              className="rounded-full w-20 h-20"
              onClick={toggleMute}
              aria-label={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? <MicOff size={32} /> : <Mic size={32} />}
            </Button>
            <Button
              variant="destructive"
              size="lg"
              className="rounded-full w-20 h-20"
              onClick={endInterview}
              aria-label="End Interview"
            >
              <PhoneOff size={32} />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
