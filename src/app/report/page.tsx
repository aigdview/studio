"use client";

import { useInterview } from "@/hooks/useInterview";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ThumbsUp, ThumbsDown, Target } from "lucide-react";

export default function ReportPage() {
  const router = useRouter();
  const { feedback, interviewStatus, resetInterview } = useInterview();

  useEffect(() => {
    if (interviewStatus !== "finished") {
      // Redirect if the user hasn't finished an interview
      router.push("/");
    }
  }, [interviewStatus, router]);
  
  const handleTryAgain = () => {
    resetInterview();
    router.push("/");
  };

  const renderMarkdownList = (text: string) => {
    if (!text) return null;
    return (
      <ul className="list-disc space-y-2 pl-5">
        {text.split('\n').map((item, index) => {
          const cleanItem = item.replace(/^- /, '').trim();
          if (cleanItem) {
            return <li key={index} className="text-sm text-foreground/80">{cleanItem}</li>;
          }
          return null;
        })}
      </ul>
    );
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 sm:p-8">
      <Card className="w-full max-w-4xl shadow-2xl">
        <CardHeader>
          <CardTitle className="text-3xl font-headline text-center">
            Interview Feedback Report
          </CardTitle>
          <CardDescription className="text-center">
            Here's a breakdown of your performance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!feedback ? (
            <div className="flex flex-col items-center justify-center gap-4 py-16">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-muted-foreground">
                Generating your feedback report...
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              <div>
                <h3 className="text-xl font-headline mb-4">Overall Summary</h3>
                <p className="text-foreground/80">{feedback.overallFeedback}</p>
              </div>

              <div className="grid md:grid-cols-3 gap-6">
                <Card>
                  <CardHeader className="flex flex-row items-center gap-2">
                    <ThumbsUp className="w-6 h-6 text-green-500" />
                    <CardTitle className="font-headline text-lg">Strengths</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {renderMarkdownList(feedback.strengths)}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center gap-2">
                     <ThumbsDown className="w-6 h-6 text-orange-500" />
                    <CardTitle className="font-headline text-lg">Weaknesses</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {renderMarkdownList(feedback.weaknesses)}
                  </CardContent>
                </Card>
                 <Card>
                  <CardHeader className="flex flex-row items-center gap-2">
                     <Target className="w-6 h-6 text-blue-500" />
                    <CardTitle className="font-headline text-lg">Areas for Improvement</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {renderMarkdownList(feedback.areasForImprovement)}
                  </CardContent>
                </Card>
              </div>
               <div className="text-center pt-6">
                 <Button onClick={handleTryAgain} size="lg">
                   Try Another Interview
                 </Button>
               </div>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
