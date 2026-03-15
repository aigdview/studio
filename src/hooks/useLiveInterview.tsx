"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useInterview } from "./useInterview";
import { useToast } from "./use-toast";
import { generateInterviewFeedback } from "@/ai/flows/generate-interview-feedback";
import type { InterviewStatus } from "@/lib/types";

const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("NEXT_PUBLIC_GEMINI_API_KEY is missing from the environment variables.");
}

const WEBSOCKET_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
const AUDIO_SAMPLE_RATE = 24000;

// This AudioWorklet is used to process audio from the microphone
// and send it to the WebSocket connection.
const workletCode = `
  class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.buffer = new Float32Array(4096);
      this.pointer = 0;
    }
    process(inputs, outputs, parameters) {
      const input = inputs[0];
      if (input && input.length > 0) {
        const channelData = input[0];
        for (let i = 0; i < channelData.length; i++) {
          this.buffer[this.pointer++] = channelData[i];
          if (this.pointer >= 4096) {
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
    setAiStatus,
    setInterviewStatus,
    setFeedback,
    interviewStatus
  } = useInterview();
  const { toast } = useToast();

  const [isMuted, setIsMuted] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null); // For SpeechRecognition
  
  const audioQueueRef = useRef<string[]>([]);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRef = useRef<number>(0);
  
  // State refs for managing connection and turn flow
  const isConnectingRef = useRef(false);
  const isTurnInterruptedRef = useRef(false);
  
  const lastSpeakerRef = useRef<string | null>(null);

  // We need a ref for the current role to use it in the endInterview callback
  const currentRoleRef = useRef<"interviewer" | "interviewee">("interviewee");
  
  // We use a ref for isMuted to access the latest value in the audio processing callback
  const isMutedRef = useRef(isMuted);
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Clean up all resources when the component unmounts or the interview ends.
  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
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
      recognitionRef.current.onend = null; // Prevent restart on cleanup
      try { recognitionRef.current.stop(); } catch(e) {}
      recognitionRef.current = null;
    }
    isConnectingRef.current = false;
  }, []);

  const stopCurrentAudio = useCallback(() => {
    activeSourcesRef.current.forEach(source => {
      source.onended = null; // Prevent onended logic from firing on manual stop
      try { source.stop(); } catch (e) {}
      source.disconnect();
    });
    activeSourcesRef.current = [];
    nextPlayTimeRef.current = 0;
    audioQueueRef.current = []; // Clear any queued audio
  }, []);
  
  const handleConnectionError = useCallback((errorType: string, message: string) => {
    toast({ title: errorType, description: message, variant: "destructive" });
    setInterviewStatus("error");
    cleanup();
  }, [toast, setInterviewStatus, cleanup]);

  const scheduleAudio = useCallback(async () => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioQueueRef.current = [];
      return;
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    const ctx = audioContextRef.current;
    
    while (audioQueueRef.current.length > 0) {
      const base64Audio = audioQueueRef.current.shift();
      if (!base64Audio) continue;

      try {
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
        audioBuffer.getChannelData(0).set(float32Data);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        const currentTime = ctx.currentTime;
        const startTime = Math.max(nextPlayTimeRef.current, currentTime + 0.05); // Add small buffer
        source.start(startTime);
        
        nextPlayTimeRef.current = startTime + audioBuffer.duration;
        activeSourcesRef.current.push(source);
        
        setAiStatus('speaking');

        source.onended = () => {
          activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source);
          if (activeSourcesRef.current.length === 0 && audioQueueRef.current.length === 0) {
            setAiStatus((prev) => (prev === 'speaking' ? 'listening' : prev));
          }
        };
      } catch (error) {
        console.error("Error playing audio chunk:", error);
      }
    }
  }, [setAiStatus]);

  const startInterview = useCallback(async (role: "interviewer" | "interviewee") => {
    if (isConnectingRef.current || wsRef.current) return;
    
    isConnectingRef.current = true;
    currentRoleRef.current = role;

    setInterviewStatus("in-progress");
    setAiStatus("thinking");
    isTurnInterruptedRef.current = false;
    lastSpeakerRef.current = null;

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

      // Initialize SpeechRecognition for live transcription (this does not send audio)
      const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
          const userLabel = role === "interviewer" ? "Interviewer (You)" : "Interviewee (You)";
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              const text = event.results[i][0].transcript.trim();
              if (text) {
                if (lastSpeakerRef.current !== userLabel) {
                  addTranscriptItem({ speaker: userLabel, text });
                  lastSpeakerRef.current = userLabel;
                } else {
                  updateLastTranscriptItem(" " + text);
                }
              }
            }
          }
        };
        recognition.onend = () => {
          // Restart recognition if it stops unexpectedly during an interview
          if (wsRef.current?.readyState === WebSocket.OPEN && interviewStatus === "in-progress") {
            try { recognition.start(); } catch (e) {
              console.error("Speech recognition restart failed:", e);
            }
          }
        };
        recognitionRef.current = recognition;
        recognition.start();
      }

      // Setup AudioContext and AudioWorklet for sending audio to AI
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

      // Setup WebSocket connection
      const ws = new WebSocket(WEBSOCKET_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        const aiInterviewerPrompt = `You are an expert technical interviewer named Echo. Conduct a realistic mock interview for the provided job description and candidate resume. Start the interview by introducing yourself and asking the first question. Speak naturally and wait for the user to respond.`;
        const aiCandidatePrompt = `You are a job candidate applying for the role in the job description, using the provided resume as your background. The user is the interviewer. Act professionally and wait for the interviewer to ask questions. Start by greeting the interviewer and confirming you are ready.`;
        
        const setupMessage = {
          setup: {
            model: "models/gemini-2.5-flash-native-audio-latest",
            systemInstruction: {
              parts: [{ text: role === 'interviewer' ? aiCandidatePrompt : aiInterviewerPrompt }],
            },
            context: {
              parts: [
                { text: `\n## Job Description:\n${jobDescription}` },
                { text: `\n## Candidate Resume:\n${resume}` },
              ]
            },
            generationConfig: {
              responseModalities: ["AUDIO", "TEXT"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
              },
            },
          },
        };
        ws.send(JSON.stringify(setupMessage));
      };
      
      // Setup AudioWorklet message handler
      workletNode.port.onmessage = (event) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || isMutedRef.current) {
          return;
        }

        const float32Audio = event.data as Float32Array;
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

        wsRef.current.send(JSON.stringify({
          realtimeInput: { mediaChunks: [{ mimeType: `audio/pcm;rate=${AUDIO_SAMPLE_RATE}`, data: base64AudioData }] }
        }));
      };

      ws.onmessage = async (event) => {
        let messageData = event.data;
        if (messageData instanceof Blob) {
          messageData = await messageData.text();
        }
        const response = JSON.parse(messageData);

        if (response.setupComplete) {
          // This is the crucial step: send the first message to kick off the conversation.
          const kickoffText = role === "interviewer"
            ? "Hello! I'll be your interviewer today. I have your resume here. Are you ready to begin?"
            : "Hello, I'm ready for the interview.";
          ws.send(JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text: kickoffText }] }], turnComplete: true }}));
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
            const aiLabel = role === "interviewer" ? "AI Candidate" : "AI Interviewer";

            for (const part of parts) {
                if (part.text) {
                  const textChunk = part.text.replace(/[.*?]|\*.*?\*/g, "").trim();
                  if (textChunk) {
                      if (lastSpeakerRef.current !== aiLabel) {
                        addTranscriptItem({ speaker: aiLabel, text: textChunk });
                        lastSpeakerRef.current = aiLabel;
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
      };

      ws.onerror = (error) => {
        console.error("WebSocket Error:", error);
        handleConnectionError("Connection Error", "Could not connect to the interview service.");
      };

      ws.onclose = (event) => {
        if (event.code === 1007) {
          handleConnectionError("Authentication Error", "The API key is invalid or has expired. Please check your configuration.");
        } else if (interviewStatus === "in-progress") {
          handleConnectionError("Connection Lost", "The connection to the interview service was lost unexpectedly.");
        }
        cleanup();
        if (workletUrl) URL.revokeObjectURL(workletUrl);
      };
    } catch (error) {
      console.error("Error starting interview:", error);
      handleConnectionError("Microphone Error", "Could not access the microphone. Please check permissions and try again.");
    }
  }, [setInterviewStatus, setAiStatus, handleConnectionError, jobDescription, resume, addTranscriptItem, updateLastTranscriptItem, scheduleAudio, stopCurrentAudio, cleanup, interviewStatus]);

  const endInterview = useCallback(async () => {
    setInterviewStatus("finished");
    setAiStatus("thinking");
    stopCurrentAudio();
    cleanup();
    
    toast({ title: "Interview Ended", description: "Generating your feedback report..." });
    
    try {
      // Add a system message to guide the AI's evaluation based on the user's role.
      const transcriptForFeedback = [
        {
          speaker: "System" as any, // Use `any` to allow "System" speaker
          text: `CRITICAL INSTRUCTION: The user played the role of '${currentRoleRef.current}'. You MUST evaluate the USER's performance in that role.`
        },
        ...transcript
      ];

      const feedbackResult = await generateInterviewFeedback({ 
        jobDescription, 
        resume, 
        transcript: transcriptForFeedback,
        userRole: currentRoleRef.current,
      });

      setFeedback(feedbackResult);
    } catch (error) {
      console.error("Error generating feedback:", error);
      toast({ title: "Feedback Error", description: "Could not generate feedback report.", variant: "destructive" });
    }
  }, [jobDescription, resume, transcript, setAiStatus, setInterviewStatus, setFeedback, toast, stopCurrentAudio, cleanup]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  // Final cleanup on unmount
  useEffect(() => {
    return () => {
      if (interviewStatus === "in-progress") {
        cleanup();
      }
    };
  }, [interviewStatus, cleanup]);

  return { startInterview, endInterview, isMuted, toggleMute };
};
