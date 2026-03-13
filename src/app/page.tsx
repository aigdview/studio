"use client";

import { useInterview } from "@/hooks/useInterview";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Bot } from "lucide-react";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export default function SetupPage() {
  const router = useRouter();
  const {
    jobDescription,
    setJobDescription,
    resume,
    setResume,
    setInterviewStatus,
  } = useInterview();
  
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);


  const handleStart = () => {
    if (jobDescription.trim() && resume.trim()) {
      setInterviewStatus("idle");
      router.push("/interview");
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 sm:p-8">
      <Card className="w-full max-w-3xl shadow-2xl">
        <CardHeader className="text-center">
          <div className="flex justify-center items-center mb-4">
              <Bot className="w-12 h-12 text-primary" />
          </div>
          <CardTitle className="text-3xl font-headline">EchoHire</CardTitle>
          <CardDescription className="text-lg">
            AI-Powered Mock Interviews
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isMounted ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="job-description" className="text-base">
                  Job Description
                </Label>
                <Textarea
                  id="job-description"
                  placeholder="Paste the job description here..."
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  className="min-h-[150px] text-sm"
                  aria-label="Job Description"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="resume" className="text-base">
                  Your Resume
                </Label>
                <Textarea
                  id="resume"
                  placeholder="Paste your resume here..."
                  value={resume}
                  onChange={(e) => setResume(e.target.value)}
                  className="min-h-[200px] text-sm"
                  aria-label="Your Resume"
                />
              </div>
            </>
          ) : (
            <div className="space-y-6">
                <div className="space-y-2">
                    <Skeleton className="h-6 w-40" />
                    <Skeleton className="h-[150px] w-full" />
                </div>
                <div className="space-y-2">
                    <Skeleton className="h-6 w-32" />
                    <Skeleton className="h-[200px] w-full" />
                </div>
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Button
            size="lg"
            className="w-full font-bold text-lg"
            onClick={handleStart}
            disabled={!jobDescription.trim() || !resume.trim()}
          >
            Start Mock Interview
          </Button>
        </CardFooter>
      </Card>
      <footer className="mt-8 text-center text-sm text-muted-foreground">
        <p>
          Prepare for your next interview with a realistic AI-driven experience.
        </p>
      </footer>
    </main>
  );
}
