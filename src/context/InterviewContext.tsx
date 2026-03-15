"use client";

import { createContext, useState, useContext, type ReactNode, Dispatch, SetStateAction } from "react";
import type {
  AiStatus,
  InterviewStatus,
  TranscriptItem,
} from "@/lib/types";
import type { GenerateInterviewFeedbackOutput } from "@/ai/flows/generate-interview-feedback";

const DEFAULT_JOB_DESCRIPTION = `Job Title: IT Project Manager
Location: [City, State / Remote]
Job Type: Full-Time

Job Summary:
We are seeking a highly organized and results-driven IT Project Manager to lead and oversee technology projects from conception to completion. In this role, you will coordinate cross-functional teams, manage project schedules, and ensure that all IT initiatives are delivered on time, within scope, and within budget.

Key Responsibilities:

Lead the planning, execution, and delivery of IT projects (e.g., software development, infrastructure upgrades, system integrations).
Define project scope, goals, and deliverables in collaboration with senior management and stakeholders.
Develop comprehensive project plans, including timelines, resource allocation, and budget estimates.
Manage and coordinate cross-functional teams, including software developers, QA engineers, and system administrators.
Identify, track, and mitigate project risks and resolve any roadblocks.
Facilitate daily stand-ups, sprint planning, and retrospective meetings (if using Agile methodologies).
Provide regular project status updates to stakeholders and executives.
Requirements & Qualifications:

Bachelor’s degree in Information Technology, Computer Science, Business Administration, or a related field.
3–5 years of proven experience in IT project management.
Strong understanding of project management methodologies (Agile, Scrum, Waterfall).
Proficiency with project management tools (e.g., Jira, Asana, MS Project, Confluence).
Excellent leadership, communication, and problem-solving skills.
PMP (Project Management Professional) or CSM (Certified ScrumMaster) certification is highly preferred.`;

const DEFAULT_RESUME = `Alex Taylor
San Francisco, CA

Professional Summary
Detail-oriented and certified IT Project Manager with over 5 years of experience leading complex technology initiatives. Proven track record of delivering software and infrastructure projects on time and under budget. Adept at bridging the gap between technical teams and business stakeholders, utilizing Agile and Scrum methodologies to drive efficiency, mitigate risks, and achieve strategic business goals.

Core Competencies

Methodologies: Agile, Scrum, Waterfall, SDLC
Tools: Jira, MS Project, MS Excel
Skills: Budget Management, Risk Mitigation, Stakeholder Communication, Resource Allocation, Cross-functional Leadership
Professional Experience

IT Project Manager
TechSolutions Inc., San Francisco, CA | June 2022 – Present

Direct the full project lifecycle for enterprise-level software development and cloud migration projects with budgets exceeding $500,000.
Lead cross-functional teams of 15+ members, including developers, QA testers, and UX/UI designers.
Successfully delivered a major CRM integration project 2 weeks ahead of schedule, resulting in a 20% increase in sales team productivity.
Facilitate Agile ceremonies, including daily stand-ups, sprint planning, and retrospectives, improving team delivery speed by 15%.
Identify and mitigate project risks, communicating status updates and key metrics to C-level executives weekly.
Junior IT Project Manager / Business Analyst
InnovateTech, San Jose, CA | August 2019 – May 2022

Assisted senior project managers in tracking project milestones, deliverables, and resource allocation using Jira and MS Project.
Gathered and documented technical requirements from business stakeholders to ensure alignment with IT capabilities.
Coordinated the rollout of a company-wide hardware upgrade, managing vendor relationships and minimizing downtime for 300+ employees.
Created and maintained comprehensive project documentation, ensuring compliance with internal IT governance standards.
Education
Bachelor of Science in Information Technology
University of California, Berkeley | Graduated: May 2019

Certifications

Project Management Professional (PMP) – Project Management Institute (PMI)`;

export type UserRole = "interviewer" | "interviewee";

interface InterviewContextType {
  jobDescription: string;
  setJobDescription: (jd: string) => void;
  resume: string;
  setResume: (resume: string) => void;
  userRole: UserRole;
  setUserRole: (role: UserRole) => void;
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
  const [userRole, setUserRole] = useState<UserRole>("interviewee"); // Default to candidate
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
    // Note: We intentionally do not reset userRole, jobDescription, or resume here 
    // so the user can easily retry the same interview scenario.
  };

  const value = {
    jobDescription,
    setJobDescription,
    resume,
    setResume,
    userRole,
    setUserRole,
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

// ADDED THIS: The custom hook so your pages can easily access the context!
export function useInterview() {
  const context = useContext(InterviewContext);
  if (context === undefined) {
    throw new Error("useInterview must be used within an InterviewProvider");
  }
  return context;
}