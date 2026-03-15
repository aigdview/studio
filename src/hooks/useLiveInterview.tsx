"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useInterview } from "@/context/InterviewContext";
import { useToast } from "./use-toast";
import { generateInterviewFeedback } from "@/ai/flows/generate-interview-feedback";

const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("NEXT_PUBLIC_GEMINI_API_KEY is missing from the environment variables.");
}

const WEBSOCKET_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
const AUDIO_SAMPLE_RATE = 24000;

// Reduced buffer size from 4096 to 2048 for lower latency capture
const workletCode = `
  class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.buffer = new Float32Array(2048);
      this.pointer = 0;
    }
    process(inputs, outputs, parameters) {
      const input = inputs[0];
      if (input && input.length > 0) {
        const channelData = input[0];
        for (let i = 0; i < channelData.length; i++) {
          this.buffer[this.pointer++] = channelData[i];
          if (this.pointer >= 2048) {
            this.port.postMessage(new Float32Array(this.buffer));
            this.pointer = 0;
          }
        }
      }
      return true;
    }
  }
  registerProcessor('audio-processor', AudioProcessor);
`;

export const useLiveInterview = () => {
  const {
    jobDescription,
    resume,
    transcript,
    addTranscriptItem,
    updateLastTranscriptItem,
    aiStatus,
    setAiStatus,
    setInterviewStatus,
    setFeedback,
  } = useInterview();
  const { toast } = useToast();

  const [isMuted, setIsMuted] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  
  const audioQueueRef = useRef<string[]>([]);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRef = useRef<number>(0);
  const isSchedulingRef = useRef<boolean>(false); // Prevents concurrent scheduling
  
  const isSetupCompleteRef = useRef(false);
  const isConnectingRef = useRef(false);
  const isTurnInterruptedRef = useRef(false);
  
  const lastSpeakerRef = useRef<string | null>(null);
  const isThinkingRef = useRef(false); 
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

  const currentRoleRef = useRef<"interviewer" | "interviewee">("interviewee");

  const isMutedRef = useRef(isMuted);
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [transcript]);

  const stopCurrentAudio = useCallback(() => {
    activeSourcesRef.current.forEach(source => {
      source.onended = null;
      try { source.stop(); } catch (e) {}
      source.disconnect();
    });
    activeSourcesRef.current = [];
    nextPlayTimeRef.current = 0;
    audioQueueRef.current = [];
    isSchedulingRef.current = false;
  }, []);

  const scheduleAudio = useCallback(async () => {
    if (isSchedulingRef.current) return;
    isSchedulingRef.current = true;

    try {
      const ctx = audioContextRef.current;
      if (!ctx || ctx.state === 'closed') return;

      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      while (audioQueueRef.current.length > 0) {
        const base64Audio = audioQueueRef.current.shift();
        if (!base64Audio) continue;

        const binaryString = atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const pcm16Data = new Int16Array(bytes.buffer);
        const float32Data = new Float32Array(pcm16Data.length);
        for (let i = 0; i < pcm16Data.length; i++) {
          float32Data[i] = pcm16Data[i] / 32768.0;
        }

        const audioBuffer = ctx.createBuffer(1, float32Data.length, AUDIO_SAMPLE_RATE);
        audioBuffer.copyToChannel(float32Data, 0); // Faster than getChannelData().set()

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        const currentTime = ctx.currentTime;
        
        // Jitter Buffer: If playback is falling behind, add a 100ms buffer to prevent stuttering
        if (nextPlayTimeRef.current < currentTime + 0.02) {
          nextPlayTimeRef.current = currentTime + 0.1; 
        }

        source.start(nextPlayTimeRef.current);
        nextPlayTimeRef.current += audioBuffer.duration;
        activeSourcesRef.current.push(source);

        setAiStatus('speaking');

        source.onended = () => {
          activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source);
          if (activeSourcesRef.current.length === 0 && audioQueueRef.current.length === 0) {
            setAiStatus((prev) => (prev === 'speaking' ? 'listening' : prev));
          }
        };
      }
    } catch (error) {
      console.error("Error playing audio chunk:", error);
    } finally {
      isSchedulingRef.current = false;
    }
  }, [setAiStatus]);

  const startInterview = useCallback(async (role: "interviewer" | "interviewee" = "interviewee") => {
    if (isConnectingRef.current || wsRef.current) return;
    isConnectingRef.current = true;
    
    currentRoleRef.current = role;

    setInterviewStatus("in-progress");
    setAiStatus("thinking");
    isSetupCompleteRef.current = false;
    isTurnInterruptedRef.current = false;
    
    lastSpeakerRef.current = null;
    isThinkingRef.current = false;

    const isUserInterviewer = role === "interviewer";
    const userLabel = isUserInterviewer ? "Interviewer (You)" : "Interviewee (You)";
    const aiLabel = isUserInterviewer ? "AI Candidate" : "AI Interviewer";
    
    let workletUrl = "";
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: AUDIO_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      mediaStreamRef.current = stream;

      const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              const text = event.results[i][0].transcript.trim();
              if (text) {
                if (lastSpeakerRef.current !== userLabel) {
                  addTranscriptItem({ speaker: userLabel, text: text });
                  lastSpeakerRef.current = userLabel;
                } else {
                  updateLastTranscriptItem(" " + text);
                }
              }
            }
          }
        };

        recognition.onend = () => {
          if (isSetupCompleteRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
            try { recognition.start(); } catch (e) {}
          }
        };

        recognitionRef.current = recognition;
        recognition.start();
      }

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: AUDIO_SAMPLE_RATE,
      });
      audioContextRef.current = audioContext;

      const blob = new Blob([workletCode], { type: 'application/javascript' });
      workletUrl = URL.createObjectURL(blob);

      await audioContext.audioWorklet.addModule(workletUrl);

      const workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(workletNode);

      const ws = new WebSocket(WEBSOCKET_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        const aiInterviewerPrompt = `You are an expert technical interviewer named Echo. Conduct a realistic mock interview for an IT role based on the provided Job Description and Candidate Resume.
CRITICAL RULES:
1. ONLY output the exact words you are speaking to the candidate.
2. NEVER output internal thoughts or actions.
3. Start the interview immediately by introducing yourself and asking the first question.`;

        const aiCandidatePrompt = `You are a job candidate applying for an IT role. The user is the interviewer. Answer their questions realistically based on the provided Candidate Resume. 
CRITICAL RULES:
1. ONLY output the exact words you are speaking to the interviewer.
2. NEVER output internal thoughts or actions.
3. Act professionally, draw upon the experience in the resume, and wait for the interviewer to guide the conversation.
4. Start by greeting the interviewer and confirming you are ready.`;

        const systemInstructionText = isUserInterviewer ? aiCandidatePrompt : aiInterviewerPrompt;

        const setupMessage = {
          setup: {
            model: "models/gemini-2.5-flash-native-audio-latest",
            systemInstruction: {
              parts: [
                {
                  text: `${systemInstructionText}\n\n## Job Description:\n${jobDescription}\n\n## Candidate Resume:\n${resume}`,
                },
              ],
            },
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
              },
            },
          },
        };
        ws.send(JSON.stringify(setupMessage));
      };

      workletNode.port.onmessage = (event) => {
        if (!isSetupCompleteRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || isMutedRef.current) {
          return;
        }

        const float32Audio = event.data as Float32Array;
        
        // --- LOCAL BARGE-IN (VAD) ---
        // Calculate RMS volume to detect if the user is speaking.
        // If volume exceeds threshold, stop AI audio instantly for smooth interruption.
        let sumSquares = 0;
        for (let i = 0; i < float32Audio.length; i++) {
          sumSquares += float32Audio[i] * float32Audio[i];
        }
        const rms = Math.sqrt(sumSquares / float32Audio.length);
        
        // 0.03 is a standard threshold for speech. Adjust slightly if mic is too sensitive.
        if (rms > 0.03 && activeSourcesRef.current.length > 0) {
          stopCurrentAudio();
          setAiStatus("listening");
        }

        const pcm16Data = new Int16Array(float32Audio.length);
        for (let i = 0; i < float32Audio.length; i++) {
          const s = Math.max(-1, Math.min(1, float32Audio[i]));
          pcm16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        const bytes = new Uint8Array(pcm16Data.buffer);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64AudioData = btoa(binary);

        const clientContentMessage = {
          realtimeInput: {
            mediaChunks: [
              {
                mimeType: `audio/pcm;rate=${AUDIO_SAMPLE_RATE}`,
                data: base64AudioData,
              },
            ],
          },
        };
        wsRef.current.send(JSON.stringify(clientContentMessage));
      };

      ws.onmessage = async (event) => {
        try {
          let messageData = event.data;
          if (messageData instanceof Blob) {
            messageData = await messageData.text();
          }

          const response = JSON.parse(messageData);
          
          if (response.setupComplete) {
            isSetupCompleteRef.current = true;
            
            const kickoffText = isUserInterviewer 
              ? "Hello! I am the interviewer. I have your resume here. Are you ready to begin?"
              : "Hello! I am ready for the interview. Please introduce yourself and ask the first question.";

            const kickoffMessage = {
              clientContent: {
                turns: [
                  {
                    role: "user",
                    parts: [{ text: kickoffText }]
                  }
                ],
                turnComplete: true
              }
            };
            ws.send(JSON.stringify(kickoffMessage));
            return;
          }

          if (response.serverContent?.interrupted) {
             isTurnInterruptedRef.current = true;
             stopCurrentAudio();
             setAiStatus("listening");
             lastSpeakerRef.current = null; 
             return; 
          }

          if (response.serverContent?.turnComplete) {
            isTurnInterruptedRef.current = false;
            setAiStatus("listening");
            lastSpeakerRef.current = null; 
          }

          const parts = response.serverContent?.modelTurn?.parts;
          if (parts) {
              isTurnInterruptedRef.current = false;

              for (const part of parts) {
                  if (part.text) {
                      let textChunk = part.text;

                      if (isThinkingRef.current) {
                        const closeIndex = textChunk.indexOf("</think>");
                        if (closeIndex !== -1) {
                          isThinkingRef.current = false;
                          textChunk = textChunk.substring(closeIndex + 8);
                        } else {
                          textChunk = ""; 
                        }
                      }

                      while (textChunk.includes("<think>")) {
                        const openIndex = textChunk.indexOf("<think>");
                        const closeIndex = textChunk.indexOf("</think>", openIndex);

                        if (closeIndex !== -1) {
                          textChunk = textChunk.substring(0, openIndex) + textChunk.substring(closeIndex + 8);
                        } else {
                          isThinkingRef.current = true;
                          textChunk = textChunk.substring(0, openIndex);
                          break;
                        }
                      }

                      textChunk = textChunk.replace(/[.*?]|\*.*?\*/g, "");

                      if (textChunk) {
                          if (lastSpeakerRef.current !== aiLabel) {
                              if (textChunk.trim().length > 0) {
                                  addTranscriptItem({ speaker: aiLabel, text: textChunk });
                                  lastSpeakerRef.current = aiLabel;
                              }
                          } else {
                              updateLastTranscriptItem(textChunk);
                          }
                      }
                  }
                  
                  if (part.inlineData?.data) {
                      if (!isTurnInterruptedRef.current) {
                          audioQueueRef.current.push(part.inlineData.data);
                          scheduleAudio(); 
                      }
                  }
              }
          }
        } catch (e) {
          console.error("Error parsing WebSocket message:", e);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket Error:", error);
        toast({ title: "Connection Error", description: "Could not connect to the interview service.", variant: "destructive" });
        setAiStatus("idle");
      };

      ws.onclose = () => {
        isConnectingRef.current = false;
        if (workletUrl) URL.revokeObjectURL(workletUrl);
      };
    } catch (error) {
      isConnectingRef.current = false;
      console.error("Error starting interview:", error);
      toast({ title: "Microphone Error", description: "Could not access the microphone. Please check permissions.", variant: "destructive" });
      setAiStatus("idle");
      setInterviewStatus("idle");
    }
  }, [setInterviewStatus, setAiStatus, toast, jobDescription, resume, addTranscriptItem, updateLastTranscriptItem, scheduleAudio, stopCurrentAudio]);

  const endInterview = useCallback(async () => {
    setAiStatus("thinking");
    stopCurrentAudio();

    if (wsRef.current) {
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (audioContextRef.current?.state !== 'closed') {
      audioContextRef.current?.close();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      try { recognitionRef.current.stop(); } catch(e) {}
      recognitionRef.current = null;
    }
    
    isConnectingRef.current = false;
    setInterviewStatus("finished");
    
    toast({ title: "Interview Ended", description: "Generating your feedback report..." });
    
    try {
      let transcriptForFeedback = transcript;
      
      if (currentRoleRef.current === "interviewer") {
        transcriptForFeedback = [
          {
            speaker: "System",
            text: "CRITICAL INSTRUCTION FOR EVALUATION: The user is the INTERVIEWER ('Interviewer (You)') in this transcript. You MUST evaluate the USER'S performance as an interviewer (e.g., question quality, structure, follow-ups). DO NOT evaluate the AI Candidate."
          },
          ...transcript
        ];
      } else {
        transcriptForFeedback = [
          {
            speaker: "System",
            text: "CRITICAL INSTRUCTION FOR EVALUATION: The user is the CANDIDATE ('Interviewee (You)') in this transcript. You MUST evaluate the USER'S performance as a candidate."
          },
          ...transcript
        ];
      }

      const feedbackResult = await generateInterviewFeedback({ 
        jobDescription, 
        resume, 
        transcript: transcriptForFeedback, 
        userRole: currentRoleRef.current 
      });

      const finalFeedback = typeof feedbackResult === "object" && feedbackResult !== null
        ? {
            ...feedbackResult,
            reportTitle: currentRoleRef.current === "interviewer"
              ? "Interview Feedback Report - Interviewer"
              : "Interview Feedback Report - Candidate"
          }
        : feedbackResult;

      setFeedback(finalFeedback as any);
    } catch (error) {
      console.error("Error generating feedback:", error);
      toast({ title: "Feedback Error", description: "Could not generate feedback report.", variant: "destructive" });
    }
  }, [jobDescription, resume, transcript, setAiStatus, setInterviewStatus, setFeedback, toast, stopCurrentAudio]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  useEffect(() => {
    return () => {
      stopCurrentAudio();
      if (wsRef.current) wsRef.current.close();
      if (audioContextRef.current?.state !== 'closed') audioContextRef.current?.close();
      if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        try { recognitionRef.current.stop(); } catch(e) {}
      }
    };
  }, [stopCurrentAudio]);

  return { startInterview, endInterview, isMuted, toggleMute, transcriptContainerRef };
};