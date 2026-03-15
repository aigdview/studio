"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useInterview } from "@/hooks/useInterview";
import { useLiveInterview } from "@/hooks/useLiveInterview";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Mic, MicOff, PhoneOff, Bot, AlertTriangle, User, UserCheck } from "lucide-react";
import { ThinkingIcon, SpeakingIcon, ListeningIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export default function InterviewPage() {
  const router = useRouter();
  
  // Manage role selection entirely within local state
  const [isRoleSelected, setIsRoleSelected] = useState(false);
  const [userRole, setUserRole] = useState<"interviewer" | "interviewee" | null>(null);

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
    // Only start the interview once the user has selected a role
    if (interviewStatus === "idle" && isRoleSelected && userRole) {
      // FIXED: Pass the selected userRole to startInterview
      startInterview(userRole); 
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewStatus, isRoleSelected, userRole]);

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

  // Render the Role Selection screen if a role hasn't been chosen yet
  if (!isRoleSelected) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center p-4 md:p-8 bg-background">
        <Card className="w-full max-w-3xl shadow-2xl">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-3xl font-bold">Choose Your Role</CardTitle>
            <CardDescription className="text-base mt-2">
              How would you like to practice today?
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col md:flex-row gap-6 p-8">
            <Button
              variant="outline"
              className="flex-1 h-auto flex-col gap-4 p-8 whitespace-normal hover:border-primary hover:bg-primary/5 transition-all"
              onClick={() => {
                setUserRole("interviewee");
                setIsRoleSelected(true);
              }}
            >
              <User className="w-16 h-16 text-primary" />
              <div className="text-center">
                <h3 className="text-xl font-bold">I am the Candidate</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  The AI will act as the interviewer and ask you questions based on your resume.
                </p>
              </div>
            </Button>

            <Button
              variant="outline"
              className="flex-1 h-auto flex-col gap-4 p-8 whitespace-normal hover:border-accent hover:bg-accent/5 transition-all"
              onClick={() => {
                setUserRole("interviewer");
                setIsRoleSelected(true);
              }}
            >
              <UserCheck className="w-16 h-16 text-accent" />
              <div className="text-center">
                <h3 className="text-xl font-bold">I am the Interviewer</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  The AI will act as the candidate. You will ask the questions and evaluate their answers.
                </p>
              </div>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render the active interview screen
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
    style={{ transform: "scale(2.3)" }}
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
    {/* Added "!" to force the size to override the Button's default rules */}
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
    {/* Added "!" to force the size to override the Button's default rules */}
    <PhoneOff className="!w-10 !h-10" />
  </Button>
</div>



        </CardContent>
      </Card>
    </div>
  );
}