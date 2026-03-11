"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useInterview } from "./useInterview";
import { useToast } from "./use-toast";
import { generateInterviewFeedback } from "@/ai/flows/generate-interview-feedback";

const WEBSOCKET_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${process.env.NEXT_PUBLIC_GEMINI_API_KEY}`;
const AUDIO_SAMPLE_RATE = 16000;

// 1. Define the worklet code as a string right inside the hook.
// This worklet now simply forwards the raw Float32Array audio data.
const workletCode = `
  class AudioProcessor extends AudioWorkletProcessor {
    process(inputs, outputs, parameters) {
      const input = inputs[0];
      if (input && input.length > 0) {
        const channelData = input[0];
        // Post a copy of the Float32Array, not the original buffer
        this.port.postMessage(new Float32Array(channelData));
      }
      return true;
    }
  }
  // The name here MUST match the name in new AudioWorkletNode
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
  } = useInterview();
  const { toast } = useToast();

  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);

  // Effect to track when the AI is speaking based on the audio queue
  useEffect(() => {
    setIsSpeaking(audioQueueRef.current.length > 0 || isPlayingRef.current);
  }, [transcript]);

  const playNextInQueue = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) {
      return;
    }
  
    isPlayingRef.current = true;
    const base64Audio = audioQueueRef.current.shift();
  
    if (base64Audio && audioContextRef.current) {
      try {
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
  
        const audioBuffer = audioContextRef.current.createBuffer(1, float32Data.length, AUDIO_SAMPLE_RATE);
        audioBuffer.getChannelData(0).set(float32Data);
  
        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContextRef.current.destination);
        source.start();
  
        source.onended = () => {
          isPlayingRef.current = false;
          playNextInQueue();
        };
      } catch (error) {
        console.error("Error playing audio:", error);
        isPlayingRef.current = false;
        playNextInQueue();
      }
    } else {
      isPlayingRef.current = false;
    }
  }, []);

  const sendAudioToGemini = useCallback((base64AudioData: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && !isMuted) {
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
      if (!isSpeaking) {
        setAiStatus("listening");
      }
    }
  }, [isMuted, setAiStatus, isSpeaking]);

  const startInterview = useCallback(async () => {
    setInterviewStatus("in-progress");
    setAiStatus("thinking");
    let workletUrl = "";
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: AUDIO_SAMPLE_RATE,
          channelCount: 1,
        }
      });
      mediaStreamRef.current = stream;

      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: AUDIO_SAMPLE_RATE,
      });

      const blob = new Blob([workletCode], { type: 'application/javascript' });
      workletUrl = URL.createObjectURL(blob);

      await audioContextRef.current.audioWorklet.addModule(workletUrl);

      const workletNode = new AudioWorkletNode(audioContextRef.current, 'audio-processor');

      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(workletNode);

      workletNode.port.onmessage = (event) => {
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

        sendAudioToGemini(base64AudioData);
      };

      wsRef.current = new WebSocket(WEBSOCKET_URL);
      wsRef.current.onopen = () => {
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
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
              },
            },
          },
        };
        wsRef.current?.send(JSON.stringify(setupMessage));
      };

      let newAiMessage = true;

      wsRef.current.onmessage = (event) => {
        const response = JSON.parse(event.data);
        if (response.serverContent?.content?.parts) {
            const part = response.serverContent.content.parts[0];
            if (part.text) {
                if (newAiMessage) {
                    addTranscriptItem({ speaker: "AI Interviewer", text: part.text });
                    newAiMessage = false;
                } else {
                    updateLastTranscriptItem(part.text);
                }
            }
        }

        if (response.serverContent?.content?.audio) {
            audioQueueRef.current.push(response.serverContent.content.audio);
            setAiStatus("speaking");
            playNextInQueue();
        }
        
        if (response.realtimeInputFeedback?.speechDetected) {
           audioQueueRef.current = [];
        }

        if(response.serverContent?.endOfResponse) {
          newAiMessage = true;
          setAiStatus("listening");
        }
      };

      wsRef.current.onerror = (error) => {
        console.error("WebSocket Error:", error);
        toast({
          title: "Connection Error",
          description: "Could not connect to the interview service.",
          variant: "destructive",
        });
        setAiStatus("idle");
      };

      wsRef.current.onclose = () => {
        URL.revokeObjectURL(workletUrl);
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        audioContextRef.current?.close();
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
  }, [setInterviewStatus, setAiStatus, sendAudioToGemini, toast, jobDescription, resume, addTranscriptItem, updateLastTranscriptItem, playNextInQueue]);

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
