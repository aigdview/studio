"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useInterview } from "./useInterview";
import { useToast } from "./use-toast";
import { generateInterviewFeedback } from "@/ai/flows/generate-interview-feedback";


const WEBSOCKET_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=AIzaSyBl-LHuzOv31rw_6DdFJYw0RJevZO_nONE`;
const AUDIO_SAMPLE_RATE = 24000;

// We only use the Worklet for the Microphone Input now.
// Output is handled by the native AudioBufferSourceNode scheduler.
const workletCode = `
  class InputProcessor extends AudioWorkletProcessor {
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
  registerProcessor('input-processor', InputProcessor);
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
  
  // Native Audio Scheduling Refs
  const nextPlayTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  
  const isSetupCompleteRef = useRef(false);
  const isConnectingRef = useRef(false);
  const isTurnInterruptedRef = useRef(false);
  
  const lastSpeakerRef = useRef<string | null>(null);
  const isThinkingRef = useRef(false); 
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

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
      try { source.stop(); } catch (e) {}
    });
    activeSourcesRef.current = [];
    nextPlayTimeRef.current = 0; // Reset scheduler
  }, []);

  // --- Bulletproof Native Audio Scheduler with Jitter Buffer ---
  const playAudioChunk = useCallback((base64Audio: string) => {
    const ctx = audioContextRef.current;
    if (!ctx) return;

    try {
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      // 1. Decode Base64 to Float32 Array
      const binary = atob(base64Audio);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      
      const int16Array = new Int16Array(bytes.buffer, 0, Math.floor(len / 2));
      const float32Data = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Data[i] = int16Array[i] / 32768;
      }

      // 2. Create AudioBuffer
      const buffer = ctx.createBuffer(1, float32Data.length, AUDIO_SAMPLE_RATE);
      buffer.getChannelData(0).set(float32Data);

      // 3. Setup Source Node
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      const currentTime = ctx.currentTime;
      
      // 4. Jitter Buffer Logic: 
      // If the scheduled time is in the past, it means we starved (network lag).
      // We push the start time 150ms into the future to build up a safe queue.
      if (nextPlayTimeRef.current < currentTime) {
        nextPlayTimeRef.current = currentTime + 0.15; 
      }

      // 5. Schedule exactly at the calculated time to prevent sparking/gaps
      source.start(nextPlayTimeRef.current);
      nextPlayTimeRef.current += buffer.duration;

      // 6. Track active sources to handle interruptions and AI status
      activeSourcesRef.current.push(source);
      source.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
        if (activeSourcesRef.current.length === 0) {
          // If all queued audio has finished playing, AI is done speaking
          setAiStatus((prev: string) => (prev === 'speaking' ? 'listening' : prev));
        }
      };
    } catch (error) {
      console.error("Error playing audio chunk:", error);
    }
  }, [setAiStatus]);

  const startInterview = useCallback(async () => {
    if (isConnectingRef.current || wsRef.current) return;
    isConnectingRef.current = true;

    setInterviewStatus("in-progress");
    setAiStatus("thinking");
    isSetupCompleteRef.current = false;
    isTurnInterruptedRef.current = false;
    
    lastSpeakerRef.current = null;
    isThinkingRef.current = false;
    nextPlayTimeRef.current = 0;
    
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
                if (lastSpeakerRef.current !== "Interviewee") {
                  addTranscriptItem({ speaker: "Interviewee", text: text });
                  lastSpeakerRef.current = "Interviewee";
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

      // Initialize Audio Context
      let audioContext: AudioContext;
      try {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: AUDIO_SAMPLE_RATE,
        });
      } catch (e) {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      audioContextRef.current = audioContext;

      const blob = new Blob([workletCode], { type: 'application/javascript' });
      workletUrl = URL.createObjectURL(blob);
      await audioContext.audioWorklet.addModule(workletUrl);

      // Setup Input Worklet (Microphone only)
      const inputNode = new AudioWorkletNode(audioContext, 'input-processor');
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(inputNode);

      const ws = new WebSocket(WEBSOCKET_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        const setupMessage = {
          setup: {
            model: "models/gemini-2.5-flash-native-audio-latest",
            systemInstruction: {
              parts: [
                {
                  text: `You are an expert technical interviewer named Echo. Your persona is professional, encouraging, and clear.

                  Your primary goal is to conduct a realistic mock interview for the IT role described below, based on the candidate's provided resume. Ask a mix of behavioral, technical, and situational questions. Start with easier questions and gradually increase the difficulty. Provide smooth transitions between questions.

                  CRITICAL RULES FOR YOUR OUTPUT:
                  1.  **FIRST MESSAGE ONLY**: Start the interview *immediately* by introducing yourself and asking the first question. Do not wait for the user to speak first. For example: "Hello, I'm Echo, your AI interviewer. It's great to connect with you. Let's start with a question about your background. Can you walk me through your resume?"
                  2.  **RESPONSE MODALITY**: You MUST output both TEXT and AUDIO for every response.
                  3.  **SPOKEN WORDS ONLY**: Your output must contain *only* the exact words you are speaking to the candidate.
                  4.  **NO META-TEXT**: Absolutely no system instructions, internal thoughts, reasoning steps, status indicators, or XML-like tags (e.g., no `<think>`, `</think>`). Do not use asterisks or brackets for actions (e.g., no *smiles* or [pauses]).
                  5.  **TURN MANAGEMENT**: After you finish asking a question, immediately cease sending audio and text and wait for the user's response. Do not send silent audio.

                  ## Job Description:
                  ${jobDescription}

                  ## Candidate Resume:
                  ${resume}`,
                },
              ],
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

      inputNode.port.onmessage = (event) => {
        if (!isSetupCompleteRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || isMutedRef.current) {
          return;
        }

        const float32Audio = event.data as Float32Array;
        const buffer = new ArrayBuffer(float32Audio.length * 2);
        const view = new DataView(buffer);
        
        for (let i = 0; i < float32Audio.length; i++) {
          const s = Math.max(-1, Math.min(1, float32Audio[i]));
          view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }

        let binary = "";
        const bytes = new Uint8Array(buffer);
        const chunkSize = 0x8000; 
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
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
            // The first message is now sent from the prompt, so no kickoff message is needed.
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

                      textChunk = textChunk.replace(/[.*?]/g, "");

                      if (textChunk) {
                          if (lastSpeakerRef.current !== "AI Interviewer") {
                              if (textChunk.trim().length > 0) {
                                  addTranscriptItem({ speaker: "AI Interviewer", text: textChunk });
                                  lastSpeakerRef.current = "AI Interviewer";
                              }
                          } else {
                              updateLastTranscriptItem(textChunk);
                          }
                      }
                  }
                  
                  if (part.inlineData?.data) {
                      if (!isTurnInterruptedRef.current) {
                          setAiStatus("speaking");
                          playAudioChunk(part.inlineData.data);
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

      ws.onclose = (event) => {
        isConnectingRef.current = false;
        if (workletUrl) URL.revokeObjectURL(workletUrl);
        // Only show toast if it was an unexpected closure
        if (event.code !== 1000) {
            toast({
                title: 'Connection To AI Closed',
                description: `Code: ${event.code}. The interview cannot continue. This may be due to an invalid API key or a network issue.`,
                variant: 'destructive',
            });
        }
      };
    } catch (error) {
      isConnectingRef.current = false;
      console.error("Error starting interview:", error);
      toast({ title: "Microphone Error", description: "Could not access the microphone. Please check permissions.", variant: "destructive" });
      setAiStatus("idle");
      setInterviewStatus("idle");
    }
  }, [setInterviewStatus, setAiStatus, toast, jobDescription, resume, addTranscriptItem, updateLastTranscriptItem, playAudioChunk, stopCurrentAudio]);

  const endInterview = useCallback(async () => {
    setAiStatus("thinking");
    stopCurrentAudio();

    if (wsRef.current) {
      wsRef.current.onclose = null; // prevent close toast from showing on manual end
      wsRef.current.close(1000, "Interview ended by user");
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
      const feedbackResult = await generateInterviewFeedback({ jobDescription, resume, transcript });
      setFeedback(feedbackResult);
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
      if (wsRef.current) {
         wsRef.current.onclose = null;
         wsRef.current.close(1000, "Component unmounting");
      }
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
