'use server';
/**
 * @fileOverview A Genkit flow for generating a detailed feedback report based on an interview transcript, job description, and resume.
 * generateInterviewFeedback - A function that triggers the feedback generation process.
 * GenerateInterviewFeedbackInput - The input type for the generateInterviewfeedback function.
 * GenerateInterviewFeedbackOutput - The return type for the generateInterviewfeedback function.
 */
import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const GenerateInterviewFeedbackInputSchema = z.object({
  jobDescription: z.string().describe('The job description for the role.'),
  resume: z.string().describe("The candidate's resume."),
  transcript: z.array(
    z.object({
      speaker: z.string().describe('The name of the speaker (e.g., "AI", "User", "Interviewer", or "Interviewee").'),
      text: z.string().describe('The spoken text.'),
    })
  ).describe('The full transcript of the interview conversation.'),
  userRole: z.enum(["interviewer", "interviewee"]).describe("The role the user played in the interview."),
});
export type GenerateInterviewFeedbackInput = z.infer<typeof GenerateInterviewFeedbackInputSchema>;

const GenerateInterviewFeedbackOutputSchema = z.object({
  reportTitle: z.string().describe("The title of the report. It must be 'Interview Feedback Report - Interviewer' if the user's role was 'interviewer', or 'Interview Feedback Report - Candidate' if the user's role was 'interviewee'."),
  overallFeedback: z.string().describe("A concise overall summary of the user's performance, in markdown format."),
  strengths: z.string().describe("Key strengths of the user during the interview, formatted as a markdown list."),
  weaknesses: z.string().describe("Weaknesses or areas where the user struggled, formatted as a markdown list."),
  areasForImprovement: z.string().describe("Actionable advice and specific areas for improvement, formatted as a markdown list."),
  recommendedAnswers: z.string().optional().describe("Recommended model answers for the candidate. Populate THIS field ONLY if userRole is 'interviewee'. Formatted as markdown."),
  recommendedQuestions: z.string().optional().describe("Recommended model questions for the interviewer. Populate THIS field ONLY if userRole is 'interviewer'. Formatted as markdown."),
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
  prompt: `You are an expert performance evaluator. Your task is to analyze a mock interview transcript, considering the provided job description, candidate resume, and the user's role.

CRITICAL INSTRUCTION: You are evaluating the human USER, not the AI. 
- If userRole is 'interviewer', the USER is the one asking the questions and evaluating the candidate. The AI is playing the candidate.
- If userRole is 'interviewee', the USER is the candidate answering the questions. The AI is playing the interviewer.

First, you MUST set the 'reportTitle' field in the output. Based on the user's role, the title must be one of the following exact strings:
- If userRole is 'interviewer', use 'Interview Feedback Report - Interviewer'.
- If userRole is 'interviewee', use 'Interview Feedback Report - Candidate'.

Then, provide a detailed feedback report in markdown format evaluating the USER's performance in their specific role.

The report must be structured with the following sections:
## Overall Summary
A concise summary of the user's performance.

## Strengths
List the user's key strengths during the interview.

## Weaknesses
List the user's weaknesses or areas where they struggled.

## Areas for Improvement
Provide actionable advice and specific areas where the user can improve for future interviews.

## Recommended Answers / Questions
Based on the user's role, provide specific examples to help them improve. You must strictly use the correct output field. 
CRITICAL FORMATTING RULE: Do NOT insert arbitrary line breaks or newlines in the middle of sentences, and NEVER put a line break inside bolded text or parentheses.

- If userRole is 'interviewer', populate the 'recommendedQuestions' field with 2-3 recommended model questions they should have asked. Do NOT populate 'recommendedAnswers'.
  Format each question exactly like this on a single continuous line:
  * **Question 1 (Theme):** "The actual question text here." *Brief explanation of why this is effective here.*

- If userRole is 'interviewee', populate the 'recommendedAnswers' field with 2-3 recommended model answers for questions they struggled with. Use the STAR method (Situation, Task, Action, Result). Do NOT populate 'recommendedQuestions'.
  Format each answer exactly like this, ensuring no awkward mid-sentence line breaks:
  * **Question:** "The question they struggled with."
    **Recommended Answer:** "The model answer here..."

---

### User's Role: {{{userRole}}}

### Job Description:
\`\`\`
{{{jobDescription}}}
\`\`\`

### Candidate Resume:
\`\`\`
{{{resume}}}
\`\`\`

### Interview Transcript:
\`\`\`
{{#each transcript}}
{{this.speaker}}: {{this.text}}
{{/each}}
\`\`\``,
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