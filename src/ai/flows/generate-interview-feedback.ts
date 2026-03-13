'use server';
/**
 * @fileOverview A Genkit flow for generating a detailed feedback report based on an interview transcript, job description, and resume.
 *
 * - generateInterviewFeedback - A function that triggers the feedback generation process.
 * - GenerateInterviewFeedbackInput - The input type for the generateInterviewfeedback function.
 * - GenerateInterviewFeedbackOutput - The return type for the generateInterviewfeedback function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const GenerateInterviewFeedbackInputSchema = z.object({
  jobDescription: z.string().describe('The job description for the role.'),
  resume: z.string().describe("The candidate's resume."),
  transcript: z.array(
    z.object({
      speaker: z.string().describe('The name of the speaker (e.g., "AI Interviewer" or "Interviewee").'),
      text: z.string().describe('The spoken text.'),
    })
  ).describe('The full transcript of the interview conversation.'),
});
export type GenerateInterviewFeedbackInput = z.infer<typeof GenerateInterviewFeedbackInputSchema>;

const GenerateInterviewFeedbackOutputSchema = z.object({
  overallFeedback: z.string().describe('A concise overall summary of the candidate\'s performance, in markdown format.'),
  strengths: z.string().describe('Key strengths of the candidate during the interview, formatted as a markdown list.'),
  weaknesses: z.string().describe('Weaknesses or areas where the candidate struggled, formatted as a markdown list.'),
  areasForImprovement: z.string().describe('Actionable advice and specific areas for improvement, formatted as a markdown list.'),
});
export type GenerateInterviewFeedbackOutput = z.infer<typeof GenerateInterviewFeedbackOutputSchema>;

export async function generateInterviewFeedback(
  input: GenerateInterviewFeedbackInput
): Promise<GenerateInterviewFeedbackOutput> {
  return generateInterviewFeedbackFlow(input);
}

const interviewFeedbackPrompt = ai.definePrompt({
  name: 'interviewFeedbackPrompt',
  input: { schema: GenerateInterviewFeedbackInputSchema },
  output: { schema: GenerateInterviewFeedbackOutputSchema },
  prompt: `You are an expert technical interviewer and performance evaluator. Your task is to analyze a mock interview transcript, considering the provided job description and candidate resume.\n\nProvide a detailed feedback report in markdown format, structured with the following sections:\n\n## Overall Feedback\nA concise summary of the candidate's performance.\n\n## Strengths\nList the candidate's key strengths during the interview.\n\n## Weaknesses\nList the candidate's weaknesses or areas where they struggled.\n\n## Areas for Improvement\nProvide actionable advice and specific areas where the candidate can improve for future interviews.\n\n---\n\n### Job Description:\n\n\`\`\`\n{{{jobDescription}}}\n\`\`\`\n\n### Candidate Resume:\n\n\`\`\`\n{{{resume}}}\n\`\`\`\n\n### Interview Transcript:\n\n\`\`\`\n{{#each transcript}}\n{{this.speaker}}: {{this.text}}\n{{/each}}\n\`\`\``,
});

const generateInterviewFeedbackFlow = ai.defineFlow(
  {
    name: 'generateInterviewFeedbackFlow',
    inputSchema: GenerateInterviewFeedbackInputSchema,
    outputSchema: GenerateInterviewFeedbackOutputSchema,
  },
  async (input) => {
    const { output } = await interviewFeedbackPrompt(input);
    return output!;
  }
);
