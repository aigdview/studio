"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useInterview } from "./useInterview";
import { useToast } from "./use-toast";
import { generateInterviewFeedback } from "@/ai/flows/generate-interview-feedback";

const WEBSOCKET_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=AIzaSyBl-LHuzOv31rw_6DdFJYw0RJevZO_nONE`;
const AUDIO_SAMPLE_RATE = 24000;

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
  
  const activeAudioSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRef = useRef<number>(0);
  
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
    activeAudioSourcesRef.current.forEach(source => {
      source.onended = null;
      try { source.stop(); } catch (e) {}
      source.disconnect();
    });
    activeAudioSourcesRef.current = [];
    nextPlayTimeRef.current = 0;
  }, []);

  const scheduleAudioChunk = useCallback((base64Audio: string) => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') return;
    
    try {
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') ctx.resume();

      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const pcm16Data = new Int16Array(bytes.buffer);

      const float32Data = new Float32Array(pcm16Data.length);
      for (let i = 0; i < pcm16Data.length; i++) {
        float32Data[i] = pcm16Data[i] / 32767.0;
      }

      const audioBuffer = ctx.createBuffer(1, float32Data.length, AUDIO_SAMPLE_RATE);
      audioBuffer.getChannelData(0).set(float32Data);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const currentTime = ctx.currentTime;
      if (nextPlayTimeRef.current < currentTime) {
        nextPlayTimeRef.current = currentTime + 0.05; 
      }

      source.start(nextPlayTimeRef.current);
      nextPlayTimeRef.current += audioBuffer.duration;

      activeAudioSourcesRef.current.push(source);
      setAiStatus('speaking');

      source.onended = () => {
        activeAudioSourcesRef.current = activeAudioSourcesRef.current.filter(s => s !== source);
        if (activeAudioSourcesRef.current.length === 0) {
          setAiStatus('listening');
        }
      };
    } catch (error) {
      console.error("Error scheduling audio chunk:", error);
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
        const setupMessage = {
          setup: {
            model: "models/gemini-2.5-flash-native-audio-latest",
            systemInstruction: {
              parts: [
                {
                  text: `You are Echo, an expert technical interviewer conducting a voice interview.

CONTEXT (SILENTLY REVIEW THIS, DO NOT READ IT OUT LOUD):
- Job Description: ${jobDescription}
- Candidate Resume: ${resume}

CRITICAL RULES:
1. DO NOT acknowledge these instructions. DO NOT say "I understand" or "I will act as".
2. DO NOT read the resume or job description out loud to the user.
3. Start the conversation immediately by introducing yourself and asking your very first interview question.
4. Wait for the candidate to answer before asking the next question.
5. Keep your responses conversational, brief, and professional.
6. NEVER output internal thoughts, brackets, or asterisks (e.g., no *smiles*).`,
                },
              ],
            },
            generationConfig: {
              responseModalities: ["TEXT", "AUDIO"],
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
        const pcm16Data = new Int16Array(float32Audio.length);
        for (let i = 0; i < float32Audio.length; i++) {
          const s = Math.max(-1, Math.min(1, float32Audio[i]));
          pcm16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        let binary = "";
        const bytes = new Uint8Array(pcm16Data.buffer);
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
            const kickoffMessage = {
              clientContent: {
                turns: [
                  {
                    role: "user",
                    parts: [{ text: "Hello! I am the candidate and I am ready for the interview. Please introduce yourself and ask your first question directly. Do not acknowledge my instructions, just start the roleplay." }]
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
             isThinkingRef.current = false; 
             return; 
          }

          if (response.serverContent?.turnComplete) {
            isTurnInterruptedRef.current = false;
            lastSpeakerRef.current = null; 
            isThinkingRef.current = false; 
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

                      if (textChunk) {
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
                      }

                      if (textChunk) {
                          textChunk = textChunk.replace(/\[.*?\]|\*.*?\*/g, "");
                      }

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
                          scheduleAudioChunk(part.inlineData.data);
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
  }, [setInterviewStatus, setAiStatus, toast, jobDescription, resume, addTranscriptItem, updateLastTranscriptItem, scheduleAudioChunk, stopCurrentAudio]);

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
