# **App Name**: EchoHire

## Core Features:

- Application Setup: User interface for inputting or editing job descriptions and candidate resumes, with pre-filled default content, before initiating the mock interview.
- Real-Time AI Interview Conductor: Manages the full-duplex conversational flow with the Gemini Multimodal Live API, handling bidirectional audio streaming and context-aware interruptions.
- Live Transcript Display: A scrollable chat-like window that continuously updates and displays the real-time text transcript of the conversation between the AI interviewer and the user.
- Advanced Audio Processing: Utilizes the Web Audio API with AudioWorkletNode to capture user microphone input (PCM 16-bit) and playback AI-generated speech, including logic for clearing audio buffers on user interruptions.
- Secure Session Management: A Firebase Cloud Function handles the secure generation of Gemini API WebSocket access tokens and the initial setup required for the live API session.
- AI-Powered Feedback Report Generation: A generative AI tool (using Gemini via a standard REST API) analyzes the complete interview transcript to intelligently compile and structure a comprehensive feedback report.
- Comprehensive Feedback Report Display: Presents the markdown-rendered AI-generated report, detailing strengths, weaknesses, and actionable areas for improvement based on the interview performance.

## Style Guidelines:

- Primary color: A sophisticated, muted indigo (#4F6287) to convey professionalism and reliability.
- Background color: A very light, desaturated blue (#EEF0F3), providing a clean and calming canvas for the application's content.
- Accent color: A vibrant, clear blue (#4AACDB) for calls-to-action and important highlights, ensuring clear user focus.
- Headline font: 'Space Grotesk' (sans-serif) for a modern, tech-informed and slightly angular aesthetic in titles and key prompts. Body text font: 'Inter' (sans-serif) for its high readability and neutral, objective presentation of interview content and reports.
- Utilize clean, minimal line icons that complement the professional and modern aesthetic, focusing on clarity for actions like 'mute/unmute' and 'end interview'.
- A responsive, multi-screen layout (Setup, Live Interview, Report) designed for optimal content display across devices, emphasizing readability and intuitive user interaction within the interview flow.
- Subtle and functional animations for screen transitions, status updates (Listening, Speaking, Thinking), and button interactions, ensuring a smooth and responsive user experience without distractions.