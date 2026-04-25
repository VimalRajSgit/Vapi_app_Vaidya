import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Audio } from "expo-av";
import Vapi from "@vapi-ai/react-native";

const SARVAM_API_KEY = "sk_y67kh1kx_yaQJQ0RJRTAC1uprpjoj0cGV";
const VAPI_API_KEY = "9903c5e9-cd86-4cc3-9c5c-32394f789ce5";
const BACKEND_URL =
  "https://e94f-2409-40f2-12e-4f21-c2ff-287e-5cd7-f605.ngrok-free.app";
const PATIENT_ID = "mr_ramesh";

const vapi = new Vapi(VAPI_API_KEY);

export default function TranscriptionScreen() {
  const [phase, setPhase] = useState<
    "intro" | "recording" | "processing" | "done"
  >("intro");
  const [transcriptLog, setTranscriptLog] = useState<string[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [isVapiActive, setIsVapiActive] = useState(false);
  const [loading, setLoading] = useState(false);

  const recording = useRef<Audio.Recording | null>(null);
  const fullTranscript = useRef<string[]>([]);
  const isRecordingLoop = useRef(false);

  useEffect(() => {
    startVapiIntro();

    vapi.on("call-start", () => {
      setTimeout(() => {
        vapi.stop();
      }, 50000);
    });

    vapi.on("call-end", () => {
      setIsVapiActive(false);
      startRecordingLoop();
    });

    return () => {
      isRecordingLoop.current = false;
      vapi.stop();
    };
  }, []);

  const startVapiIntro = async () => {
    setIsVapiActive(true);
    setPhase("intro");

    try {
      await vapi.start({
        firstMessage:
          "Hello Doctor, I am Vaidya AI. Do you need a summary of the patient before we begin?",
        transcriber: {
          provider: "deepgram",
          model: "nova-2",
          language: "en-IN",
        },
        model: {
          provider: "custom-llm",
          url: BACKEND_URL,
          model: "vaidya-transcription",
          messages: [
            {
              role: "system",
              content: `You are Vaidya AI, a medical assistant.
If doctor says Yes → give a short summary of patient ${PATIENT_ID} from records. Then say "Starting recording now." and end the call.
If doctor says No → say "Starting recording now." and end the call immediately.
Keep responses very short. Do not ask anything else.`,
            },
          ],
        },
        voice: {
          provider: "azure",
          voiceId: "kn-IN-GaganNeural",
        },
      });
    } catch (err) {
      console.error("Vapi error:", err);
      setIsVapiActive(false);
      startRecordingLoop();
    }
  };

  const startRecordingLoop = async () => {
    await Audio.requestPermissionsAsync();
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    setPhase("recording");
    isRecordingLoop.current = true;
    fullTranscript.current = [];

    while (isRecordingLoop.current) {
      try {
        const { recording: rec } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY,
        );
        recording.current = rec;

        await sleep(3000);

        await rec.stopAndUnloadAsync();
        const uri = rec.getURI();
        recording.current = null;

        if (!uri) continue;

        const text = await transcribeChunk(uri);
        if (!text) continue;

        fullTranscript.current.push(text);
        setTranscriptLog((prev) => [...prev.slice(-30), text]);
      } catch (err) {
        await sleep(500);
      }
    }
  };

  const transcribeChunk = async (uri: string): Promise<string | null> => {
    try {
      const formData = new FormData();
      formData.append("file", {
        uri,
        name: "chunk.m4a",
        type: "audio/x-m4a",
      } as any);
      formData.append("model", "saaras:v3");
      formData.append("language_code", "kn-IN");

      const res = await fetch("https://api.sarvam.ai/speech-to-text", {
        method: "POST",
        headers: {
          "api-subscription-key": SARVAM_API_KEY,
        },
        body: formData,
      });

      const result = await res.json();
      return result.transcript?.trim() || null;
    } catch {
      return null;
    }
  };

  const stopRecording = async () => {
    isRecordingLoop.current = false;
    setPhase("processing");
    setLoading(true);

    if (recording.current) {
      try {
        await recording.current.stopAndUnloadAsync();
      } catch {}
      recording.current = null;
    }

    await saveTranscript();
    setLoading(false);
    setPhase("done");
  };

  const saveTranscript = async () => {
    const fullText = fullTranscript.current.join("\n");
    if (!fullText.trim()) {
      setSummary("No transcript recorded.");
      return;
    }

    try {
      const res = await fetch(`${BACKEND_URL}/save-transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: fullTranscript.current,
          timestamp: new Date().toISOString(),
        }),
      });

      const data = await res.json();
      setSummary(data.summary || "No summary generated.");
    } catch (err) {
      console.error("Save failed:", err);
      setSummary("Failed to save transcript.");
    }
  };

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Vaidya AI 🎙️</Text>

      <View style={styles.statusBadge}>
        <Text style={styles.statusText}>
          {phase === "intro" && "🤖 Vaidya is speaking..."}
          {phase === "recording" && "🔴 Recording in progress"}
          {phase === "processing" && "⏳ Generating summary..."}
          {phase === "done" && "✅ Done"}
        </Text>
      </View>

      {isVapiActive && (
        <ActivityIndicator
          size="large"
          color="#4CAF50"
          style={{ marginBottom: 20 }}
        />
      )}

      {phase === "recording" && (
        <TouchableOpacity style={styles.stopButton} onPress={stopRecording}>
          <Text style={styles.stopButtonText}>⏹️ Stop & Summarize</Text>
        </TouchableOpacity>
      )}

      {loading && (
        <ActivityIndicator
          size="large"
          color="#0000ff"
          style={{ marginTop: 20 }}
        />
      )}

      {transcriptLog.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📝 Live Transcript</Text>
          {transcriptLog
            .slice(-5)
            .reverse()
            .map((t, i) => (
              <Text key={i} style={styles.cardText}>
                {t}
              </Text>
            ))}
        </View>
      )}

      {summary && (
        <View style={styles.summaryCard}>
          <Text style={styles.cardTitle}>📋 Consultation Summary</Text>
          <Text style={styles.cardText}>{summary}</Text>
        </View>
      )}

      {phase === "done" && (
        <TouchableOpacity
          style={styles.restartButton}
          onPress={() => {
            setTranscriptLog([]);
            setSummary(null);
            fullTranscript.current = [];
            startVapiIntro();
          }}
        >
          <Text style={styles.stopButtonText}>🔄 New Consultation</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#fff" },
  title: {
    fontSize: 26,
    fontWeight: "bold",
    marginBottom: 20,
    textAlign: "center",
  },
  statusBadge: {
    backgroundColor: "#e3f2fd",
    padding: 10,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 20,
  },
  statusText: { fontSize: 16, color: "#1565c0", fontWeight: "bold" },
  stopButton: {
    backgroundColor: "#f44336",
    padding: 18,
    borderRadius: 50,
    alignItems: "center",
    marginBottom: 20,
  },
  restartButton: {
    backgroundColor: "#4CAF50",
    padding: 18,
    borderRadius: 50,
    alignItems: "center",
    marginTop: 20,
    marginBottom: 40,
  },
  stopButtonText: { color: "white", fontSize: 18, fontWeight: "bold" },
  card: {
    backgroundColor: "#f0f0f0",
    padding: 15,
    borderRadius: 10,
    marginTop: 20,
  },
  summaryCard: {
    backgroundColor: "#e8f5e9",
    padding: 15,
    borderRadius: 10,
    marginTop: 20,
  },
  cardTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 10 },
  cardText: { fontSize: 14, lineHeight: 22 },
});
