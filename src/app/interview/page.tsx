"use client";


import { useInterview } from "@/context/InterviewContext";
// import { useInterview } from "@/context/InterviewContext";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
// import { useInterview } from "@/hooks/useInterview";
import { useLiveInterview } from "@/hooks/useLiveInterview";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Mic, MicOff, PhoneOff, Bot, AlertTriangle, User, UserCheck } from "lucide-react";
import { ThinkingIcon, SpeakingIcon, ListeningIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export default function InterviewPage() {
  const router = useRouter();
  
  // 1. Pull userRole directly from your global context
  const {
    jobDescription,
    resume,
    userRole,
    aiStatus,
    interviewStatus,
    resetInterview,
  } = useInterview(); 

  const { startInterview, endInterview, isMuted, toggleMute } =
    useLiveInterview();

  useEffect(() => {
    // 2. Automatically start the interview since we already have the userRole from page 1
    if (interviewStatus === "idle" && userRole) {
      startInterview(userRole); 
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewStatus, userRole]);

  useEffect(() => {
    if (interviewStatus === "finished") {
      router.push("/report");
    }
  }, [interviewStatus, router]);

  useEffect(() => {
    // 3. Kick them back to the setup page if they somehow bypassed it without a role, resume, or job description
    if (!jobDescription || !resume || !userRole) {
      router.push("/");
    }
  }, [jobDescription, resume, userRole, router]);
  
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

  // Render the active interview screen directly
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center p-4 md:p-8">
      <Card className="w-full max-w-4xl h-full flex flex-col shadow-2xl relative">

        {/* Small badge to remind the user of their role */}
        <div className="absolute top-4 left-0 w-full flex justify-center pointer-events-none">
          <div 
            className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-2 origin-top pointer-events-auto border shadow-sm transition-colors
              ${userRole === "interviewer" 
                ? "bg-blue-50 text-blue-700 border-blue-200" 
                : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}
            style={{ transform: "scale(2.2)" }}
          >
            {userRole === "interviewer" ? (
              <><UserCheck size={14} className="text-blue-600" /> You are the Interviewer</>
            ) : (
              <><User size={14} className="text-emerald-600" /> You are the Candidate</>
            )}
          </div>
        </div>

        <CardContent className="flex-1 flex flex-col p-4 md:p-6 overflow-hidden mt-8">
          <div className="flex-1 grid place-items-center overflow-hidden">
            <div className="flex flex-col items-center justify-center h-4/5 p-6 bg-muted/50 rounded-lg w-full max-w-md">
              <StatusIndicator />
            </div>
          </div>

          <div className="flex justify-center items-center gap-12 pt-6 mt-6 border-t shrink-0">
            <Button
              variant={isMuted ? "outline" : "secondary"}
              className="rounded-full w-24 h-24"
              onClick={toggleMute}
              aria-label={isMuted ? "Unmute" : "Mute"}
              disabled={interviewStatus === 'error'}
            >
              {isMuted ? (
                <MicOff className="!w-10 !h-10" />
              ) : (
                <Mic className="!w-10 !h-10" />
              )}
            </Button>

            <Button
              variant="destructive"
              className="rounded-full w-24 h-24"
              onClick={endInterview}
              aria-label="End Interview"
              disabled={interviewStatus === 'error'}
            >
              <PhoneOff className="!w-10 !h-10" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}