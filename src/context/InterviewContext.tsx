"use client";

import { createContext, useState, type ReactNode, Dispatch, SetStateAction } from "react";
import type {
  AiStatus,
  InterviewStatus,
  TranscriptItem,
} from "@/lib/types";
import type { GenerateInterviewFeedbackOutput } from "@/ai/flows/generate-interview-feedback";

const DEFAULT_JOB_DESCRIPTION = `Junior Full Stack Developer

Experience: 1-2 years
Location: Remote

We are looking for a motivated Junior Full Stack Developer to join our team. The ideal candidate will have experience with React for the frontend, Node.js for the backend, and familiarity with Firebase for database and hosting services.

Responsibilities:
- Develop and maintain web applications using React and Node.js.
- Collaborate with designers and other developers.
- Work with Firebase services like Firestore and Cloud Functions.
- Write clean, maintainable, and efficient code.

Requirements:
- 1-2 years of experience in web development.
- Proficiency in JavaScript, React, and Node.js.
- Experience with RESTful APIs.
- Basic understanding of Firebase or other NoSQL databases.
- Good problem-solving skills and a can-do attitude.`;

const DEFAULT_RESUME = `Jane Doe
(123) 456-7890 | jane.doe@email.com | linkedin.com/in/janedoe

Summary
Aspiring Full Stack Developer with 1.5 years of hands-on experience in building and maintaining web applications. Proficient in the MERN stack with a strong focus on creating responsive and user-friendly interfaces. Eager to contribute to a dynamic team and grow my skills in a collaborative environment.

Experience
Web Developer Intern | Tech Solutions Inc. | June 2023 - Present
- Contributed to the development of a client-facing dashboard using React and Redux, improving user engagement by 15%.
- Built and integrated RESTful APIs using Node.js and Express to support new application features.
- Utilized Firebase for real-time data synchronization and user authentication in a project application.
- Participated in agile development cycles, including sprint planning and daily stand-ups.

Projects
E-commerce Store | Personal Project
- Developed a full-stack e-commerce website using React, Node.js, and MongoDB.
- Implemented features like product catalog, shopping cart, and user authentication.

Skills
- Frontend: React, Redux, HTML5, CSS3, Tailwind CSS
- Backend: Node.js, Express.js
- Databases: MongoDB, Firebase (Firestore)
- Tools: Git, Webpack, npm`;

interface InterviewContextType {
  jobDescription: string;
  setJobDescription: (jd: string) => void;
  resume: string;
  setResume: (resume: string) => void;
  transcript: TranscriptItem[];
  setTranscript: Dispatch<SetStateAction<TranscriptItem[]>>;
  addTranscriptItem: (item: TranscriptItem) => void;
  updateLastTranscriptItem: (text: string) => void;
  interviewStatus: InterviewStatus;
  setInterviewStatus: (status: InterviewStatus) => void;
  aiStatus: AiStatus;
  setAiStatus: (status: AiStatus) => void;
  feedback: GenerateInterviewFeedbackOutput | null;
  setFeedback: (feedback: GenerateInterviewFeedbackOutput | null) => void;
  resetInterview: () => void;
}

export const InterviewContext = createContext<InterviewContextType | undefined>(
  undefined
);

export function InterviewProvider({ children }: { children: ReactNode }) {
  const [jobDescription, setJobDescription] = useState(DEFAULT_JOB_DESCRIPTION);
  const [resume, setResume] = useState(DEFAULT_RESUME);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [interviewStatus, setInterviewStatus] =
    useState<InterviewStatus>("idle");
  const [aiStatus, setAiStatus] = useState<AiStatus>("idle");
  const [feedback, setFeedback] =
    useState<GenerateInterviewFeedbackOutput | null>(null);

  const addTranscriptItem = (item: TranscriptItem) => {
    setTranscript((prev) => [...prev, item]);
  };

  const updateLastTranscriptItem = (text: string) => {
    setTranscript((prev) => {
      if (prev.length === 0) return prev;
      const lastItem = prev[prev.length - 1];
      const newTranscript = [...prev];
      newTranscript[newTranscript.length - 1] = {
        ...lastItem,
        text: lastItem.text + text,
      };
      return newTranscript;
    });
  };
  
  const resetInterview = () => {
    setTranscript([]);
    setInterviewStatus("idle");
    setAiStatus("idle");
    setFeedback(null);
  };

  const value = {
    jobDescription,
    setJobDescription,
    resume,
    setResume,
    transcript,
    setTranscript,
    addTranscriptItem,
    updateLastTranscriptItem,
    interviewStatus,
    setInterviewStatus,
    aiStatus,
    setAiStatus,
    feedback,
    setFeedback,
    resetInterview,
  };

  return (
    <InterviewContext.Provider value={value}>
      {children}
    </InterviewContext.Provider>
  );
}
