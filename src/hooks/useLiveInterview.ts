"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useInterview } from "./useInterview";
import { useToast } from "./use-toast";
import { generateInterviewFeedback } from "@/ai/flows/generate-interview-feedback";

const WEBSOCKET_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${process.env.NEXT_PUBLIC_GEMINI_API_KEY}`;
const AUDIO_SAMPLE_RATE = 16000;

const workletCode = `
  class AudioProcessor extends AudioWorkletProcessor {
    process(inputs, outputs, parameters) {
      const input = inputs[0];
      if (input && input.length > 0) {
        const channelData = input[0];
        this.port.postMessage(new Float32Array(channelData));
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
    setTranscript,
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
  
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);
  const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const isSetupCompleteRef = useRef(false);

  const isMutedRef = useRef(isMuted);
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const playNextInQueue = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) {
      if (!isPlayingRef.current) {
        setAiStatus((prev) => (prev === 'speaking' ? 'listening' : prev));
      }
      return;
    }

    isPlayingRef.current = true;
    setAiStatus('speaking');
    
    const base64Audio = audioQueueRef.current.shift();

    if (base64Audio && audioContextRef.current) {
      try {
        // Ensure AudioContext is running (browsers can suspend it)
        if (audioContextRef.current.state === 'suspended') {
          await audioContextRef.current.resume();
        }

        const audioData = atob(base64Audio);
        const pcm16Data = new Int16Array(audioData.length / 2);
        for (let i = 0; i < pcm16Data.length; i++) {
          const byte1 = audioData.charCodeAt(i * 2);
          const byte2 = audioData.charCodeAt(i * 2 + 1);
          pcm16Data[i] = (byte2 << 8) | byte1;
        }

        const float32Data = new Float32Array(pcm16Data.length);
        for (let i = 0; i < pcm16Data.length; i++) {
          float32Data[i] = pcm16Data[i] / 32767.0;
        }

        const audioBuffer = audioContextRef.current.createBuffer(1, float32Data.length, 24000);
        audioBuffer.getChannelData(0).set(float32Data);

        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContextRef.current.destination);
        currentAudioSourceRef.current = source;

        source.onended = () => {
          currentAudioSourceRef.current = null;
          isPlayingRef.current = false;
          playNextInQueue();
        };

        source.start();
      } catch (error) {
        console.error("Error playing audio:", error);
        currentAudioSourceRef.current = null;
        isPlayingRef.current = false;
        playNextInQueue();
      }
    } else {
      isPlayingRef.current = false;
      playNextInQueue();
    }
  }, [setAiStatus]);

  const startInterview = useCallback(async () => {
    setInterviewStatus("in-progress");
    setAiStatus("thinking");
    isSetupCompleteRef.current = false;
    let workletUrl = "";
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: AUDIO_SAMPLE_RATE,
          channelCount: 1,
        }
      });
      mediaStreamRef.current = stream;

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
                  text: `You are an expert technical interviewer named Echo. Conduct a realistic mock interview for an IT role based on the provided Job Description and Candidate Resume. Your goal is to assess the candidate's skills and experience. Ask one question at a time. Wait for the candidate's response. Ask follow-up questions based on their answers. Be conversational, professional, and act like a real human. Start the interview by introducing yourself and asking the first question. If the candidate interrupts you, stop your current thought and address their interruption naturally.\n\n## Job Description:\n${jobDescription}\n\n## Candidate Resume:\n${resume}`,
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
        // DO NOT send audio until the server has completed setup
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
        
        setAiStatus((prev) => (prev !== 'speaking' ? 'listening' : prev));
      };
      
      let newAiMessage = true;

      ws.onmessage = (event) => {
        try {
          const response = JSON.parse(event.data);
          
          // 1. Handle Setup Complete & Kickoff the Interview
          if (response.setupComplete) {
            isSetupCompleteRef.current = true;
            
            // Force the AI to start speaking by sending an initial text prompt
            const kickoffMessage = {
              clientContent: {
                turns: [
                  {
                    role: "user",
                    parts: [{ text: "Hello! I am ready for the interview. Please introduce yourself and ask the first question." }]
                  }
                ],
                turnComplete: true
              }
            };
            ws.send(JSON.stringify(kickoffMessage));
            return;
          }

          // 2. Handle AI Responses (Text and Audio)
          const parts = response.serverContent?.modelTurn?.parts || response.serverContent?.content?.parts;
          if (parts) {
              for (const part of parts) {
                  if (part.text) {
                      if (newAiMessage) {
                          addTranscriptItem({ speaker: "AI Interviewer", text: part.text });
                          newAiMessage = false;
                      } else {
                          updateLastTranscriptItem(part.text);
                      }
                  }
                  
                  const audioData = part.inlineData?.data || response.serverContent?.content?.audio;
                  if (audioData) {
                      audioQueueRef.current.push(audioData);
                      playNextInQueue();
                  }
              }
          }

          // 3. Handle User Speech Transcription
          if (response.speechRecognitionResult) {
            const { text, isFinal } = response.speechRecognitionResult;
            if (text) {
              setTranscript(currentTranscript => {
                  const lastEntry = currentTranscript.length > 0 ? currentTranscript[currentTranscript.length - 1] : null;
                  if (lastEntry && lastEntry.speaker === 'Candidate' && !lastEntry.isFinal) {
                      const newTranscript = [...currentTranscript];
                      newTranscript[newTranscript.length - 1] = { ...lastEntry, text: text, isFinal: isFinal };
                      return newTranscript;
                  } 
                  else if (text.trim()) {
                       return [...currentTranscript, { speaker: 'Candidate', text: text, isFinal: isFinal }];
                  }
                  return currentTranscript;
              });
            }
          }

          // 4. Handle Interruptions
          if (response.serverContent?.interrupted || response.realtimeInputFeedback?.speechDetected) {
             audioQueueRef.current = [];
             isPlayingRef.current = false;
             // Immediately stop the currently playing audio chunk
             if (currentAudioSourceRef.current) {
                currentAudioSourceRef.current.stop();
                currentAudioSourceRef.current = null;
             }
          }

          // 5. Handle End of AI Turn
          if(response.serverContent?.turnComplete || response.serverContent?.endOfResponse) {
            newAiMessage = true;
            setAiStatus("listening");
          }
        } catch (e) {
          console.error("Error parsing WebSocket message:", e);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket Error:", error);
        toast({
          title: "Connection Error",
          description: "Could not connect to the interview service.",
          variant: "destructive",
        });
        setAiStatus("idle");
      };

      ws.onclose = (event) => {
        console.log("WebSocket closed:", event.code, event.reason);
        if (workletUrl) URL.revokeObjectURL(workletUrl);
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        if (audioContextRef.current?.state !== 'closed') {
            audioContextRef.current?.close();
        }
      };
    } catch (error) {
      console.error("Error starting interview:", error);
      toast({
        title: "Microphone Error",
        description: "Could not access the microphone. Please check permissions.",
        variant: "destructive",
      });
      setAiStatus("idle");
      setInterviewStatus("idle");
      if (workletUrl) URL.revokeObjectURL(workletUrl);
    }
  }, [setInterviewStatus, setAiStatus, toast, jobDescription, resume, addTranscriptItem, updateLastTranscriptItem, playNextInQueue, setTranscript]);

  const endInterview = useCallback(async () => {
    setAiStatus("thinking");
    wsRef.current?.close();
    setInterviewStatus("finished");
    toast({
      title: "Interview Ended",
      description: "Generating your feedback report...",
    });
    try {
      const feedbackResult = await generateInterviewFeedback({
        jobDescription,
        resume,
        transcript,
      });
      setFeedback(feedbackResult);
    } catch (error) {
      console.error("Error generating feedback:", error);
      toast({
        title: "Feedback Error",
        description: "Could not generate feedback report.",
        variant: "destructive",
      });
    }
  }, [jobDescription, resume, transcript, setAiStatus, setInterviewStatus, setFeedback, toast]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  return { startInterview, endInterview, isMuted, toggleMute };
};
