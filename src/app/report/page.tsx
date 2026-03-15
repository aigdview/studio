"use client";

// import { useInterview } from "@/hooks/useInterview";
import { useInterview } from "@/context/InterviewContext";

import { useRouter } from "next/navigation";
import React, { useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Loader2, 
  ThumbsUp, 
  ThumbsDown, 
  Target, 
  Lightbulb, 
  HelpCircle 
} from "lucide-react";

interface FormattedItem {
  title: string | null;
  content: string;
}

export default function ReportPage() {
  const router = useRouter();
  const { feedback, interviewStatus, resetInterview, userRole } = useInterview();

  useEffect(() => {
    if (interviewStatus !== "finished") {
      router.push("/");
    }
  }, [interviewStatus, router]);
  
  const handleTryAgain = () => {
    resetInterview();
    router.push("/");
  };

  const renderMarkdownList = (text: string | null | undefined, highlightQuestions: boolean = false) => {
    if (!text) return null;

    // Clean up literal escaped newlines and weird asterisk artifacts
    let cleanText = text.replace(/\\n/g, '\n').replace(/\*\s*\n\s*\*/g, '\n');
    cleanText = cleanText.replace(/([.?!'"]|\*)\s*(Question\s+\d+)/gi, '$1\n$2');
    cleanText = cleanText.replace(/([.?!'"])\s*(?:[-*]\s*)+(?=[A-Z*])/g, '$1\n');
    cleanText = cleanText.replace(/(:)([A-Za-z])/g, '$1 $2');

    let lines = cleanText.split('\n').map(line => line.trim()).filter(Boolean);

    let formattedItems: FormattedItem[] = [];
    let currentItem: FormattedItem | null = null;

    lines.forEach(line => {
      let cleanedLine = line
        .replace(/^(?:[-•]|\d+\.)\s*/, '')
        .replace(/^\*+/, '')
        .trim();

      // 1. Skip lines that are purely markdown formatting, punctuation, or spaces (e.g., "** **")
      if (/^[\s*#\-_~.:]+$/.test(cleanedLine)) {
        return;
      }

      // 2. Catch conversational intros before the first real bullet point
      if (!currentItem) {
        const normalizedLine = cleanedLine.replace(/[*#:]/g, '').trim().toLowerCase();
        const redundantHeaders = [
          'recommended questions',
          'recommended answers',
          'strengths',
          'weaknesses',
          'areas for improvement',
          'questions',
          'answers',
          'questions to ask',
          'questions to consider',
          'interview questions'
        ];
        
        const isRedundantHeader = 
          redundantHeaders.includes(normalizedLine) || 
          /^(here are|below are|these are|the following|some|potential|recommended|key).*(questions|answers|strengths|weaknesses|improvements?|areas|points)/.test(normalizedLine);

        if (isRedundantHeader) {
          return; // Skip this line so it doesn't become an empty bullet
        }
      }

      const colonMatch = cleanedLine.match(/^\**([^.?!:]{2,80}?)\**:\**(.*)/);

      if (colonMatch) {
        const title = colonMatch[1].replace(/\*/g, '').trim(); 
        const content = colonMatch[2].trim();
        
        if (currentItem && title.toLowerCase().includes('answer')) {
          currentItem.content += `\n**${title}:** ${content}`;
        } else {
          if (currentItem) formattedItems.push(currentItem);
          currentItem = { title, content };
        }
      } else {
        if (!currentItem) {
          currentItem = { title: null, content: cleanedLine };
        } else {
          currentItem.content += '\n' + cleanedLine;
        }
      }
    });

    if (currentItem) formattedItems.push(currentItem);

    // 3. Final safety filter to remove completely empty ghost bullets
    formattedItems = formattedItems.filter(item => {
      const titleIsJustNoise = !item.title || /^[\s*#\-_~.:]*$/.test(item.title);
      const contentIsJustNoise = !item.content || /^[\s*#\-_~.:]*$/.test(item.content);
      // Keep the item if EITHER the title OR the content has actual text
      return !titleIsJustNoise || !contentIsJustNoise;
    });

    if (formattedItems.length === 0) {
      return <p className="text-sm text-muted-foreground italic">No specific points provided.</p>;
    }

    const renderContent = (content: string) => {
      let safeContent = content.replace(/\*+$/, '').trim();
      
      return safeContent.split('\n').map((line, lineIndex, array) => {
        if (line.trim() === '') {
          return <br key={lineIndex} />;
        }

        const parts = line.split(/(\*\*.*?\*\*)/g);
        
        return (
          <React.Fragment key={lineIndex}>
            {parts.map((part, i) => {
              if (part.startsWith('**') && part.endsWith('**')) {
                const innerText = part.slice(2, -2);
                const isQuestionInline = highlightQuestions && innerText.toLowerCase().includes('question');
                
                return (
                  <strong 
                    key={i} 
                    className={`font-bold ${
                      isQuestionInline 
                        ? 'bg-primary/15 text-primary px-1.5 py-0.5 rounded-md mr-1 inline-block mb-1' 
                        : 'text-foreground'
                    }`}
                  >
                    {innerText}
                  </strong>
                );
              }
              return <span key={i}>{part}</span>;
            })}
            {lineIndex < array.length - 1 && <br />}
          </React.Fragment>
        );
      });
    };

    return (
      <ul className="list-disc space-y-6 pl-5">
        {formattedItems.map((item, index) => {
          const isQuestionTitle = highlightQuestions && item.title && item.title.toLowerCase().includes('question');
          
          return (
            <li key={index} className="text-sm text-foreground/80 leading-relaxed">
              {item.title && (
                <strong 
                  className={`font-bold mr-1 ${
                    isQuestionTitle 
                      ? 'bg-primary/15 text-primary px-1.5 py-0.5 rounded-md inline-block mb-1' 
                      : 'text-foreground'
                  }`}
                >
                  {item.title}:
                </strong>
              )}
              {renderContent(item.content)}
            </li>
          );
        })}
      </ul>
    );
  };

  if (interviewStatus !== "finished") {
    return null;
  }

  const currentUserRole = userRole || feedback?.userRole || "interviewee"; 

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 sm:p-8">
      <Card className="w-full max-w-4xl shadow-2xl">
        <CardHeader>
          <CardTitle className="text-3xl font-headline text-center">
            {feedback?.reportTitle || "Interview Feedback Report"}
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
                <p className="text-foreground/80 whitespace-pre-wrap">{feedback.overallFeedback}</p>
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

              <div className="w-full">
                {currentUserRole === "interviewee" ? (
                  <Card>
                    <CardHeader className="flex flex-row items-center gap-2">
                      <Lightbulb className="w-6 h-6 text-yellow-500" />
                      <CardTitle className="font-headline text-lg">Recommended Answers</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {feedback.recommendedAnswers ? (
                        renderMarkdownList(feedback.recommendedAnswers, true)
                      ) : (
                        <p className="text-sm text-muted-foreground italic">
                          No recommended answers provided.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ) : currentUserRole === "interviewer" ? (
                  <Card>
                    <CardHeader className="flex flex-row items-center gap-2">
                      <HelpCircle className="w-6 h-6 text-purple-500" />
                      <CardTitle className="font-headline text-lg">Recommended Questions</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {feedback.recommendedQuestions ? (
                        renderMarkdownList(feedback.recommendedQuestions, true)
                      ) : (
                        <p className="text-sm text-muted-foreground italic">
                          No recommended questions provided.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ) : null}
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