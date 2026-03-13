"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useInterview } from "@/hooks/useInterview";
import { useLiveInterview } from "@/hooks/useLiveInterview";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Mic, MicOff, PhoneOff, Bot, User } from "lucide-react";
import { ThinkingIcon, SpeakingIcon, ListeningIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export default function InterviewPage() {
  const router = useRouter();
  const {
    jobDescription,
    resume,
    transcript,
    aiStatus,
    interviewStatus,
  } = useInterview();

  const { startInterview, endInterview, isMuted, toggleMute, transcriptContainerRef } =
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

  // Improved auto-scroll: Added a slight delay to ensure the DOM has painted 
  // the new transcript bubbles before attempting to scroll.
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (transcriptContainerRef.current) {
        transcriptContainerRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [transcript, transcriptContainerRef]);


  const StatusIndicator = () => {
    let icon, text, color;

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
          <div className="flex-1 grid md:grid-cols-2 gap-6 overflow-hidden">
            <div className="flex flex-col items-center justify-center h-full p-6 bg-muted/50 rounded-lg">
              <StatusIndicator />
            </div>
            
            <div className="flex flex-col h-full min-h-0">
              <h2 className="text-xl font-headline mb-4 border-b pb-2 shrink-0">
                Live Transcript
              </h2>
              
              {/* 
                BULLETPROOF SCROLL CONTAINER: 
                We make the wrapper `relative flex-1 min-h-0` and the ScrollArea `absolute inset-0`.
                This forces the ScrollArea to perfectly respect the boundaries of its parent.
              */}
              <div className="relative flex-1 min-h-0">
                <ScrollArea className="absolute inset-0 pr-4">
                  <div className="flex flex-col gap-4 pb-4">
                    {transcript.map((item, index) => (
                      <div
                        key={index}
                        className={cn("flex items-start gap-3", {
                          "justify-end": item.speaker === "Interviewee",
                        })}
                      >
                        {item.speaker === "AI Interviewer" && (
                          <span className="flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-full bg-primary text-primary-foreground">
                            <Bot size={18} />
                          </span>
                        )}
                        <div
                          className={cn("max-w-xs md:max-w-md rounded-lg p-3", {
                            "bg-primary/10": item.speaker === "AI Interviewer",
                            "bg-accent/20": item.speaker === "Interviewee",
                          })}
                        >
                          <p className="font-bold text-sm mb-1">
                            {item.speaker}
                          </p>
                          <p className="text-sm">{item.text}</p>
                        </div>
                        {item.speaker === "Interviewee" && (
                          <span className="flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-full bg-accent text-accent-foreground">
                            <User size={18} />
                          </span>
                        )}
                      </div>
                    ))}
                    <div ref={transcriptContainerRef} className="h-1" />
                  </div>
                </ScrollArea>
              </div>
            </div>
          </div>
          <div className="flex justify-center items-center gap-4 pt-6 mt-6 border-t shrink-0">
            <Button
              variant={isMuted ? "outline" : "secondary"}
              size="lg"
              className="rounded-full w-16 h-16"
              onClick={toggleMute}
              aria-label={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
            </Button>
            <Button
              variant="destructive"
              size="lg"
              className="rounded-full w-16 h-16"
              onClick={endInterview}
              aria-label="End Interview"
            >
              <PhoneOff size={24} />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
