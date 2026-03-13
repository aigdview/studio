export type TranscriptItem = {
  speaker: "AI Interviewer" | "Candidate";
  text: string;
  isFinal?: boolean;
};

export type InterviewStatus = "idle" | "in-progress" | "finished";
export type AiStatus = "idle" | "listening" | "speaking" | "thinking";

    