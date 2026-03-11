"use client";

import { useContext } from "react";
import { InterviewContext } from "@/context/InterviewContext";

export const useInterview = () => {
  const context = useContext(InterviewContext);
  if (context === undefined) {
    throw new Error("useInterview must be used within an InterviewProvider");
  }
  return context;
};
